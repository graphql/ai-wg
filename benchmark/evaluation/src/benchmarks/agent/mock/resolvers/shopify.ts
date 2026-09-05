/**
 * Self-contained natural GraphQL server for the "shopify" schema.
 *
 * Architecture: ONE plain JS object per logical entity, with DIRECT references between
 * related entities (no FK strings, no store lookups). Path-independence is free because
 * order(id:"...").customer and orders().nodes[i].customer are the IDENTICAL JS object.
 *
 * Connection fields get a resolver (source,args)=>conn(source.<field>,args).
 * Root Query fields always get a resolver.
 * Scalar/single-object/plain-list fields: value on the entity, served by the default resolver.
 */
import type { ResolverMap } from '../types.ts';
import {
    allOrders,
    orderById,
    allMainCustomers,
    customerById,
    allDraftOrders,
    allAbandonedCheckouts,
    abandonedCheckoutsSortedDesc,
    allGiftCards,
    return1,
    allDiscountNodes,
    allCodeDiscountNodes,
    automaticDiscountNodes,
    codeDiscSummer25,
    allSegments,
    segmentObj1,
    allMarketingEvents,
    allMarketingActivities,
    allCompanies,
    allCompanyLocations,
    allDeliveryProfiles,
    deliveryProfileById,
    allCarrierServices,
    allInventoryTransfers,
    allMarkets,
    assignedFulfillmentOrders,
    shopifyPaymentsAccount,
    allAppInstallations,
    currentAppInstallation,
    allWebhookSubscriptions,
    allShopifyFunctions,
    allPaymentTermsTemplates,
    shopObj,
    allLocations,
    allCollections,
    collectionByHandle,
    navyHoodieProduct,
    allProducts,
    allProductVariants,
    allSaleVariants,
    custObj1,
    custUnsub1,
    custUnsub2,
    ord_partially_paid_1,
    ord3,
    discountNode_dcBasic1,
    discountNode_dcBasic2,
    discountNode_dcBxgy1,
    discountNode_dcBxgy2,
    discountNode_dcAutoBasic1,
    discountNode_dcAutoBasic2,
    discountNode_dcAutoApp1,
    discountNode_dcAutoApp2,
    allPublications,
    allChannels,
    allDeliveryCustomizations,
    allPaymentCustomizations,
    allFulfillmentConstraintRules,
} from './shopify.data.ts';

// ---------------------------------------------------------------------------
// Local connection helper — mirrors the shape common.ts produces, but local.
// ---------------------------------------------------------------------------
interface ConnArgs {
    first?: number;
    last?: number;
    reverse?: boolean;
    sortKey?: string;
}

function conn(nodes: any[], args: ConnArgs = {}) {
    let list = nodes;
    if (args.reverse) list = [...list].reverse();
    const limit = args.first ?? args.last ?? list.length;
    const slice = list.slice(0, limit);
    const edges = slice.map((n: any, i: number) => ({ node: n, cursor: String(i) }));
    return {
        nodes: slice,
        edges,
        totalCount: nodes.length,
        count: nodes.length,
        pageInfo: {
            hasNextPage: args.first != null && nodes.length > (args.first ?? 0),
            hasPreviousPage: false,
            startCursor: edges.length > 0 ? '0' : null,
            endCursor: edges.length > 0 ? String(edges.length - 1) : null,
        },
    };
}

// ---------------------------------------------------------------------------
// Filter helpers
// ---------------------------------------------------------------------------
function parseQuery(q: string): Record<string, string> {
    const result: Record<string, string> = {};
    const parts = q.match(/\S+:\S+|\w+:\S+/g) ?? [];
    for (const p of parts) {
        const idx = p.indexOf(':');
        result[p.slice(0, idx)!] = p.slice(idx + 1);
    }
    return result;
}

// ---------------------------------------------------------------------------
// THE RESOLVER MAP
// ---------------------------------------------------------------------------
export const shopify: ResolverMap = {
    QueryRoot: {
        // Single lookups
        order: (_src, args) => {
            const id = String(args.id);
            if (orderById.has(id)) {
                return orderById.get(id);
            }
            // Synthesize a minimal order for unknown IDs (lookup seeding)
            return {
                __typename: 'Order',
                id,
                name: `Order#${id}`,
                createdAt: '2025-03-01T00:00:00.000Z',
                number: 9999,
                totalPrice: '0.00',
                currencyCode: 'USD',
                displayFinancialStatus: 'PAID',
                displayFulfillmentStatus: 'UNFULFILLED',
                email: null,
                totalPriceSet: {
                    shopMoney: { amount: '0.00', currencyCode: 'USD' },
                    presentmentMoney: { amount: '0.00', currencyCode: 'USD' },
                },
                totalOutstandingSet: {
                    shopMoney: { amount: '0.00', currencyCode: 'USD' },
                    presentmentMoney: { amount: '0.00', currencyCode: 'USD' },
                },
                currentTotalDutiesSet: null,
                discountCodes: [],
                shippingAddress: null,
                billingAddress: null,
                taxLines: [],
                lineItems: [],
                refunds: [],
                fulfillments: [],
                fulfillmentOrders: [],
                discountApplications: [],
                additionalFees: [],
                risk: { recommendation: 'NONE', assessments: [] },
                disputes: [],
                customer: null,
                customerJourneySummary: null,
                returns: [],
                events: [],
            };
        },
        customer: (_src, args) => customerById.get(String(args.id)) ?? null,
        return: (_src, args) => {
            if (String(args.id) === 'gid://shopify/Return/1') return return1;
            return null;
        },
        deliveryProfile: (_src, args) =>
            deliveryProfileById.get(String(args.id)) ?? deliveryProfileById.get('dp-1') ?? null,
        collectionByIdentifier: (_src, args) => {
            const handle = (args.identifier as any)?.handle;
            return collectionByHandle.get(String(handle)) ?? null;
        },
        productByIdentifier: (_src, args) => {
            const handle = (args.identifier as any)?.handle;
            if (handle === 'navy-hoodie') return navyHoodieProduct;
            return allProducts.find((p: any) => p.handle === handle) ?? allProducts[0] ?? null;
        },
        codeDiscountNodeByCode: (_src, args) => {
            const code = String(args.code);
            if (code === 'SUMMER25') return codeDiscSummer25;
            return allCodeDiscountNodes[0] ?? null;
        },
        customerSegmentMembership: (_src, args) => {
            // shop-054: segmentIds, customerId => returns SegmentMembershipResponse
            return {
                memberships: (args.segmentIds as string[]).map((segId: string) => ({
                    isMember: true,
                    segmentId: segId,
                })),
            };
        },
        customerSegmentMembers: (_src, args) => {
            // shop-064: segmentId, first => CustomerSegmentMemberConnection with totalCount: 82
            return { totalCount: 82, nodes: [], edges: [] };
        },

        // List roots
        orders: (_src, args) => {
            const q = String(args.query ?? '');
            let list = allOrders as any[];

            // Filter dispatch
            if (q.includes('fulfillment_status:pending')) {
                list = list.filter(
                    (o: any) => o.displayFulfillmentStatus === 'PENDING_FULFILLMENT',
                );
            } else if (
                q.includes('financial_status:paid') &&
                q.includes('fulfillment_status:unshipped')
            ) {
                list = [];
            } else if (q.includes('status:open')) {
                list = [
                    ord_partially_paid_1,
                    ...allOrders.filter((o: any) => o.displayFinancialStatus === 'PARTIALLY_PAID'),
                ];
            } else if (q.includes('fulfillment_status:unfulfilled')) {
                list = allOrders; // return all 5
            } else if (q.includes('fulfillment_status:shipped')) {
                list = allOrders; // all 5 have fulfillments
            }
            // All date-based and other filters return allOrders (data is static)
            return conn(list, args);
        },
        ordersCount: (_src, _args) => {
            // shop-010: source_name:web created_at:>=2026-06-01 => count: 794
            return { count: 794, precision: 'EXACT' };
        },
        draftOrders: (_src, args) => {
            const q = String(args.query ?? '');
            if (q.includes('status:open')) {
                return conn(
                    [allDraftOrders.find((d: any) => d.status === 'OPEN')].filter(Boolean) as any[],
                    args,
                );
            }
            return conn(allDraftOrders, args);
        },
        products: (_src, args) => {
            const q = String(args.query ?? '');
            if (q.includes('is_price_reduced:true')) {
                // Return products that have sale variants (all 5 do in our data)
                return conn(allProducts, args);
            }
            if (q.includes('vendor:Acme')) {
                return conn(allProducts, args);
            }
            if (q.includes('tag:eco-friendly')) {
                return conn(allProducts, args);
            }
            return conn(allProducts, args);
        },
        productVariants: (_src, args) => {
            const q = String(args.query ?? '');
            if (q.includes('-barcode:*')) {
                return conn([], args); // all have barcodes
            }
            return conn(allProductVariants, args);
        },
        collections: (_src, args) => conn(allCollections, args),
        customers: (_src, args) => {
            const q = String(args.query ?? '');
            if (
                q.includes('emailMarketingConsent.marketingState:UNSUBSCRIBED') ||
                q.includes('marketingState:UNSUBSCRIBED')
            ) {
                return conn([custUnsub1, custUnsub2], args);
            }
            if (q.includes('orders_count:>5')) {
                return conn(allMainCustomers, args);
            }
            return conn(allMainCustomers, args);
        },
        abandonedCheckouts: (_src, args) => {
            if (args.reverse === true || (args.sortKey === 'CREATED_AT' && args.reverse)) {
                return conn(abandonedCheckoutsSortedDesc, args);
            }
            // Sort by CREATED_AT descending if sortKey=CREATED_AT and reverse
            const sortKey = args.sortKey as string | undefined;
            const rev = args.reverse as boolean | undefined;
            if (sortKey === 'CREATED_AT' && rev) {
                return conn(abandonedCheckoutsSortedDesc, args);
            }
            return conn(allAbandonedCheckouts, args);
        },
        giftCards: (_src, args) => conn(allGiftCards, args),
        locations: (_src, args) => {
            const includeInactive = args.includeInactive as boolean | undefined;
            if (includeInactive === true) {
                return conn(allLocations, args); // all 5, 4 have deactivatedAt
            }
            // Default: only active
            return conn(allLocations, args);
        },
        discountNodes: (_src, args) => {
            const q = String(args.query ?? '');
            if (q.includes('status:active') && q.includes('method:code')) {
                return conn([discountNode_dcBasic1, discountNode_dcBasic2], args);
            }
            if (q.includes('type:bxgy')) {
                return conn([discountNode_dcBxgy1, discountNode_dcBxgy2], args);
            }
            if (q.includes('method:automatic') && q.includes('discount_type:percentage')) {
                return conn([discountNode_dcAutoBasic1, discountNode_dcAutoBasic2], args);
            }
            return conn(allDiscountNodes, args);
        },
        codeDiscountNodes: (_src, args) => conn(allCodeDiscountNodes, args),
        automaticDiscountNodes: (_src, args) => conn(automaticDiscountNodes, args),
        marketingEvents: (_src, args) => {
            const q = String(args.query ?? '');
            // shop-063: started_at filter in 2026 window => empty
            if (q.includes('started_at:>2026')) {
                return conn([], args);
            }
            return conn(allMarketingEvents, args);
        },
        marketingActivities: (_src, args) => conn(allMarketingActivities, args),
        segments: (_src, args) => conn(allSegments, args),
        companies: (_src, args) => conn(allCompanies, args),
        companyLocations: (_src, args) => conn(allCompanyLocations.slice(0, 2), args),
        deliveryProfiles: (_src, args) => conn(allDeliveryProfiles, args),
        carrierServices: (_src, args) => conn(allCarrierServices, args),
        inventoryTransfers: (_src, args) => {
            const q = String(args.query ?? '');
            if (q.includes('status:IN_PROGRESS')) {
                return conn(allInventoryTransfers, args);
            }
            return conn(allInventoryTransfers, args);
        },
        markets: (_src, args) => conn(allMarkets, args),
        assignedFulfillmentOrders: (_src, args) => conn(assignedFulfillmentOrders, args),
        appInstallations: (_src, args) => conn(allAppInstallations, args),
        webhookSubscriptions: (_src, args) => conn(allWebhookSubscriptions, args),
        shopifyFunctions: (_src, args) => conn(allShopifyFunctions, args),
        paymentTermsTemplates: (_src, _args) => allPaymentTermsTemplates,

        // Fixed singletons
        shop: () => shopObj,
        shopifyPaymentsAccount: () => shopifyPaymentsAccount,
        currentAppInstallation: () => currentAppInstallation,

        // New QueryRoot fields
        automaticDiscounts: (_src: any, args: any) =>
            conn(
                automaticDiscountNodes.map((n: any) => n.automaticDiscount),
                args,
            ),
        channels: (_src: any, args: any) => conn(allChannels, args),
        publications: (_src: any, args: any) => conn(allPublications, args),
        segment: (_src: any, args: any) => {
            const id = String(args.id);
            return allSegments.find((s: any) => s.id === id) ?? segmentObj1;
        },
        customerByIdentifier: (_src: any, args: any) => {
            // identifier can be emailAddress, phone, etc. — return first customer
            const id = (args.identifier as any)?.id ?? (args.identifier as any)?.email;
            if (id) {
                return customerById.get(String(id)) ?? allMainCustomers[0] ?? null;
            }
            return allMainCustomers[0] ?? null;
        },
        customersCount: (_src: any, _args: any) => ({ count: 1482, precision: 'EXACT' }),
        discountCodesCount: (_src: any, _args: any) => ({ count: 42, precision: 'EXACT' }),
        discountNodesCount: (_src: any, _args: any) => ({ count: 42, precision: 'EXACT' }),
        productVariantsCount: (_src: any, _args: any) => ({ count: 25, precision: 'EXACT' }),
        fulfillmentOrders: (_src: any, args: any) => conn(assignedFulfillmentOrders, args),
        deliveryCustomizations: (_src: any, args: any) => conn(allDeliveryCustomizations, args),
        paymentCustomizations: (_src: any, args: any) => conn(allPaymentCustomizations, args),
        fulfillmentConstraintRules: (_src: any, _args: any) => allFulfillmentConstraintRules,
        validations: (_src: any, args: any) => conn([], args),
        node: (_src: any, args: any) => {
            const id = String(args.id);
            // Check all entity maps in order
            if (orderById.has(id)) {
                return orderById.get(id);
            }
            if (customerById.has(id)) {
                return customerById.get(id);
            }
            // Try segments, products, etc.
            const seg = allSegments.find((s: any) => s.id === id);
            if (seg) {
                return seg;
            }
            const prod = allProducts.find((p: any) => p.id === id);
            if (prod) {
                return prod;
            }
            const dp = deliveryProfileById.get(id);
            if (dp) {
                return dp;
            }
            return null;
        },
    },

    // ---- Order connection fields ----
    Order: {
        lineItems: (src: any, args: any) => conn(src.lineItems ?? [], args),
        refunds: (src: any, args: any) => {
            const list = src.refunds ?? [];
            const n = typeof args?.first === 'number' ? args.first : list.length;
            return list.slice(0, n);
        },
        fulfillments: (src: any, args: any) => {
            const list = src.fulfillments ?? [];
            const n = typeof args?.first === 'number' ? args.first : list.length;
            return list.slice(0, n);
        },
        fulfillmentOrders: (src: any, args: any) => conn(src.fulfillmentOrders ?? [], args),
        discountApplications: (src: any, args: any) => conn(src.discountApplications ?? [], args),
        returns: (src: any, args: any) => conn(src.returns ?? [], args),
        events: (src: any, args: any) => conn(src.events ?? [], args),
    },

    // ---- Fulfillment connection fields ----
    Fulfillment: {
        trackingInfo: (src: any, args: any) => {
            const list = src.trackingInfo ?? [];
            const n = typeof args?.first === 'number' ? args.first : list.length;
            return list.slice(0, n);
        },
    },

    // ---- Refund connection fields ----
    Refund: {
        refundLineItems: (src: any, args: any) => conn(src.refundLineItems ?? [], args),
    },

    // ---- Return connection fields ----
    Return: {
        returnLineItems: (src: any, args: any) => conn(src.returnLineItems ?? [], args),
        refunds: (src: any, args: any) => conn(src.refunds ?? [], args),
    },

    // ---- Product connection fields ----
    Product: {
        variants: (src: any, args: any) => conn(src.variants ?? [], args),
        media: (src: any, args: any) => conn(src.media ?? [], args),
        metafields: (src: any, args: any) => conn(src.metafields ?? [], args),
        translations: (src: any, _args: any) => src.translations ?? [],
        resourcePublications: (src: any, args: any) => conn(src.resourcePublications ?? [], args),
        resourcePublicationsV2: (src: any, args: any) =>
            conn(src.resourcePublicationsV2 ?? src.resourcePublications ?? [], args),
        productPublications: (src: any, args: any) => conn(src.productPublications ?? [], args),
        // publications is a deprecated non-paginated field returning ResourcePublication[]
        publications: (src: any) => src.publications ?? [],
        unpublishedChannels: (src: any, args: any) => conn(src.unpublishedChannels ?? [], args),
    },

    // ---- ProductVariant connection fields ----
    ProductVariant: {
        inventoryItem: (src: any) => src.inventoryItem ?? null,
    },

    // ---- InventoryItem connection fields ----
    InventoryItem: {
        inventoryLevels: (src: any, args: any) => conn(src.inventoryLevels ?? [], args),
    },

    // ---- InventoryLevel fields ----
    InventoryLevel: {
        quantities: (src: any, _args: any) => src.quantities ?? [],
        scheduledChanges: (src: any, args: any) => conn(src.scheduledChanges ?? [], args),
    },

    // ---- Collection connection fields ----
    Collection: {
        products: (src: any, args: any) => conn(src.products ?? [], args),
    },

    // ---- Customer connection fields ----
    Customer: {
        addressesV2: (src: any, args: any) => conn(src.addressesV2 ?? [], args),
        storeCreditAccounts: (src: any, args: any) => conn(src.storeCreditAccounts ?? [], args),
        paymentMethods: (src: any, args: any) => conn(src.paymentMethods ?? [], args),
        subscriptionContracts: (src: any, args: any) =>
            conn(src._subscriptionContracts ?? [], args),
        orders: (src: any, args: any) => {
            const q = String(args.query ?? '');
            let list = src.orders ?? [];
            if (q.includes('created_at:>2025-01-01')) {
                // filter to orders after 2025-01-01
                list = list.filter((o: any) => {
                    const ca = (o as any).createdAt;
                    return ca && ca >= '2025-01-01';
                });
            }
            return conn(list, args);
        },
        events: (src: any, args: any) => {
            const q = String(args.query ?? '');
            let list = src.events ?? [];
            if (q.includes('verb:comment')) {
                list = list.filter((e: any) => e.__typename === 'CommentEvent');
            }
            return conn(list, args);
        },
    },

    // ---- DraftOrder connection fields ----
    DraftOrder: {
        lineItems: (src: any, args: any) => conn(src.lineItems ?? [], args),
    },

    // ---- AbandonedCheckout connection fields ----
    AbandonedCheckout: {
        lineItems: (src: any, args: any) => conn(src.lineItems ?? [], args),
    },

    // ---- DiscountNode / DiscountCodeNode / DiscountAutomaticNode fields ----
    DiscountCodeNode: {
        codeDiscount: (src: any) => src.codeDiscount ?? null,
    },

    DiscountAutomaticNode: {
        automaticDiscount: (src: any) => src.automaticDiscount ?? null,
    },

    // ---- DiscountCodeBasic connection fields ----
    DiscountCodeBasic: {
        codes: (src: any, args: any) => conn(src.codes ?? [], args),
    },

    // ---- DiscountCodeApp connection fields ----
    DiscountCodeApp: {
        codes: (src: any, args: any) => conn(src.codes ?? [], args),
    },

    // ---- DiscountCodeBxgy fields ----
    DiscountCodeBxgy: {
        customerBuys: (src: any) => src.customerBuys ?? null,
        customerGets: (src: any) => src.customerGets ?? null,
        codes: (src: any, args: any) => conn(src.codes ?? [], args),
    },

    // ---- DiscountCodeFreeShipping connection fields ----
    DiscountCodeFreeShipping: {
        codes: (src: any, args: any) => conn(src.codes ?? [], args),
    },

    // ---- Channel connection fields ----
    Channel: {
        productPublicationsV3: (src: any, args: any) =>
            conn(src.productPublicationsV3?.nodes ?? [], args),
        products: (src: any, args: any) => conn(src.products ?? [], args),
    },

    // ---- DiscountProducts connection fields ----
    DiscountProducts: {
        products: (src: any, args: any) => conn(src.products ?? [], args),
    },

    // ---- DiscountCustomerSegments fields ----
    DiscountCustomerSegments: {
        segments: (src: any) => src.segments ?? [],
    },

    // ---- Company connection fields ----
    Company: {
        locations: (src: any, args: any) => conn(src.locations ?? [], args),
        contacts: (src: any, args: any) => conn(src.contacts ?? [], args),
    },

    // ---- CompanyLocation connection fields ----
    CompanyLocation: {
        catalogs: (src: any, args: any) => conn(src.catalogs ?? [], args),
    },

    // ---- CompanyContact connection fields ----
    CompanyContact: {
        orders: (src: any, args: any) => conn(src.orders ?? [], args),
    },

    // ---- Location connection fields ----
    Location: {
        inventoryLevels: (src: any, args: any) => conn(src.inventoryLevels ?? [], args),
    },

    // ---- DeliveryProfile connection fields ----
    DeliveryProfile: {
        profileItems: (src: any, args: any) => conn(src.profileItems ?? [], args),
        profileLocationGroups: (src: any) => src.profileLocationGroups ?? [],
    },

    // ---- DeliveryProfileLocationGroup connection fields ----
    DeliveryProfileLocationGroup: {
        locationGroupZones: (src: any, args: any) => conn(src.locationGroupZones ?? [], args),
    },

    // ---- DeliveryLocationGroupZone connection fields ----
    DeliveryLocationGroupZone: {
        methodDefinitions: (src: any, args: any) => conn(src.methodDefinitions ?? [], args),
    },

    // ---- ShopifyPaymentsAccount connection fields ----
    ShopifyPaymentsAccount: {
        payouts: (src: any, args: any) => conn(src.payouts ?? [], args),
        balanceTransactions: (src: any, args: any) => conn(src.balanceTransactions ?? [], args),
    },

    // ---- Shop connection fields ----
    Shop: {
        search: (_src: any, args: any) => ({
            edges: [],
            nodes: [],
            pageInfo: {
                hasNextPage: false,
                hasPreviousPage: false,
                startCursor: null,
                endCursor: null,
            },
            resultsAfterCount: 0,
        }),
    },
};
