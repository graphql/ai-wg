/**
 * Shared object-graph data for the "shopify" mock.
 * ONE plain JS object per logical entity; direct object-references for relationships.
 * Path-independence is automatic: the same JS object is reachable via every access path.
 */
import { stableHash } from '../seed.ts';

// ---------------------------------------------------------------------------
// Seed helper
// ---------------------------------------------------------------------------
function h(key: string) {
    return stableHash(key);
}

// ---------------------------------------------------------------------------
// Money helpers
// ---------------------------------------------------------------------------
function money(amount: string, currencyCode: string) {
    return { amount, currencyCode };
}
function moneyBag(amount: string, currencyCode: string) {
    return {
        presentmentMoney: money(amount, currencyCode),
        shopMoney: money(amount, currencyCode),
    };
}

// ---------------------------------------------------------------------------
// Deterministic realistic-value generators (seed-derived, no Date.now/Math.random)
// Each derives a believable value from a string key so siblings differ but are stable.
// ---------------------------------------------------------------------------
const US_PROVINCES: Array<[string, string]> = [
    ['CA', 'California'],
    ['TX', 'Texas'],
    ['NY', 'New York'],
    ['FL', 'Florida'],
    ['IL', 'Illinois'],
    ['PA', 'Pennsylvania'],
    ['OH', 'Ohio'],
    ['GA', 'Georgia'],
    ['NC', 'North Carolina'],
    ['MI', 'Michigan'],
    ['WA', 'Washington'],
    ['AZ', 'Arizona'],
    ['MA', 'Massachusetts'],
    ['TN', 'Tennessee'],
    ['CO', 'Colorado'],
    ['OR', 'Oregon'],
    ['MD', 'Maryland'],
    ['NJ', 'New Jersey'],
    ['VA', 'Virginia'],
    ['NV', 'Nevada'],
];
const PROVINCE_NAME_BY_CODE: Record<string, string> = Object.fromEntries(US_PROVINCES);
const CITIES = [
    'Los Angeles',
    'Houston',
    'New York',
    'Miami',
    'Chicago',
    'Philadelphia',
    'Columbus',
    'Atlanta',
    'Charlotte',
    'Detroit',
    'Seattle',
    'Phoenix',
    'Boston',
    'Nashville',
    'Denver',
    'Portland',
    'San Diego',
    'Dallas',
    'Austin',
    'Minneapolis',
];
const STREET_NAMES = [
    'Maple Avenue',
    'Oak Street',
    'Cedar Lane',
    'Pine Road',
    'Elm Street',
    'Birch Way',
    'Walnut Drive',
    'Willow Court',
    'Chestnut Boulevard',
    'Spruce Place',
    'Aspen Trail',
    'Magnolia Drive',
    'Sycamore Street',
    'Juniper Lane',
    'Poplar Avenue',
    'Dogwood Court',
];
const FIRST_NAMES = [
    'Emma',
    'Liam',
    'Olivia',
    'Noah',
    'Ava',
    'James',
    'Sophia',
    'William',
    'Isabella',
    'Benjamin',
    'Mia',
    'Lucas',
    'Charlotte',
    'Henry',
    'Amelia',
    'Mason',
    'Harper',
    'Logan',
];
const LAST_NAMES = [
    'Smith',
    'Johnson',
    'Williams',
    'Brown',
    'Jones',
    'Garcia',
    'Miller',
    'Davis',
    'Rodriguez',
    'Martinez',
    'Hernandez',
    'Lopez',
    'Gonzalez',
    'Wilson',
    'Anderson',
    'Thomas',
];
const COMPANY_WORDS = [
    'Summit',
    'Pioneer',
    'Horizon',
    'Evergreen',
    'Northstar',
    'Brightline',
    'Cornerstone',
    'Vanguard',
    'Meridian',
    'Cascade',
    'Riverbend',
    'Ironwood',
    'Lakeshore',
    'Stonegate',
];

function pick<T>(arr: T[], key: string): T {
    return arr[h(key) % arr.length]!;
}

// A street address line: "<number> <street>"
function streetAddress(key: string): string {
    return `${(h(`${key}#num`) % 9000) + 100} ${pick(STREET_NAMES, `${key}#street`)}`;
}
// A realistic 5-digit US ZIP.
function zipCode(key: string): string {
    return String((h(`${key}#zip`) % 89999) + 10000);
}
// A [code, name] province pair.
function province(key: string): [string, string] {
    return pick(US_PROVINCES, `${key}#prov`);
}
// A realistic money amount like "149.95".
function amount(key: string): string {
    const dollars = (h(`${key}#d`) % 980) + 5; // 5..984
    const centsTable = ['00', '49', '95', '99', '25', '50', '75', '29'];
    const cents = pick(centsTable, `${key}#c`);
    return `${dollars}.${cents}`;
}
// A realistic full name "<First> <Last>".
function fullName(key: string): string {
    return `${pick(FIRST_NAMES, `${key}#fn`)} ${pick(LAST_NAMES, `${key}#ln`)}`;
}
// A realistic email derived from a name key.
function emailAddr(key: string): string {
    const f = pick(FIRST_NAMES, `${key}#fn`).toLowerCase();
    const l = pick(LAST_NAMES, `${key}#ln`).toLowerCase();
    const n = h(`${key}#n`) % 100;
    const domains = ['example.com', 'mailbox.test', 'shopmail.example', 'inbox.example'];
    return `${f}.${l}${n}@${pick(domains, `${key}#dom`)}`;
}
// A formatted multi-line address array given an address1/city/provinceCode/zip.
function formattedAddress(
    address1: string,
    city: string,
    provinceCode: string,
    zip: string,
): string[] {
    return [address1, `${city}, ${provinceCode} ${zip}`, 'United States'];
}

// ---------------------------------------------------------------------------
// Locations (5 locations; Location.name-1858 is ACTIVE — no deactivatedAt)
// ---------------------------------------------------------------------------
function mkLocation(id: string, name: string, isActive: boolean, deactivatedAt: string | null) {
    const seed = h(`Location#${id}`);
    const a1 = streetAddress(`Location.addr#${id}`);
    const city = pick(CITIES, `Location.city#${id}`);
    const [pc] = province(`Location.prov#${id}`);
    const zip = zipCode(`Location.zip#${id}`);
    return {
        __typename: 'Location',
        id,
        _seed: seed,
        name,
        isActive,
        deactivatedAt,
        address: {
            formatted: formattedAddress(a1, city, pc, zip),
        },
        inventoryLevels: [] as any[],
    };
}

export const loc1 = mkLocation('loc-1', 'Airport Logistics', true, '2024-03-18T00:00:00.000Z');
export const loc2 = mkLocation('loc-2', 'Industrial Park', true, null); // ACTIVE — no deactivatedAt
export const loc3 = mkLocation('loc-3', 'West Fulfillment', false, '2024-08-02T00:00:00.000Z');
export const loc4 = mkLocation('loc-4', 'Northern Facility', false, '2025-01-27T00:00:00.000Z');
export const loc5 = mkLocation('loc-5', 'Downtown Store', false, '2025-04-09T00:00:00.000Z');

// Add realistic LocationAddress fields (address1, address2, city, province, zip, country, countryCode, formatted)
// and fulfillmentService to each location
const locationAddresses: Record<string, any> = {
    'loc-1': {
        address1: '1200 Airport Blvd',
        address2: 'Suite 100',
        city: 'Los Angeles',
        province: 'California',
        zip: '90045',
        country: 'United States',
        countryCode: 'US',
        formatted: [
            '1200 Airport Blvd Suite 100',
            'Los Angeles, California 90045',
            'United States',
        ],
    },
    'loc-2': {
        address1: '450 Industrial Pkwy',
        address2: null,
        city: 'Chicago',
        province: 'Illinois',
        zip: '60601',
        country: 'United States',
        countryCode: 'US',
        formatted: ['450 Industrial Pkwy', 'Chicago, Illinois 60601', 'United States'],
    },
    'loc-3': {
        address1: '3300 West Commerce St',
        address2: 'Unit B',
        city: 'Dallas',
        province: 'Texas',
        zip: '75208',
        country: 'United States',
        countryCode: 'US',
        formatted: ['3300 West Commerce St Unit B', 'Dallas, Texas 75208', 'United States'],
    },
    'loc-4': {
        address1: '789 Northern Ave',
        address2: null,
        city: 'Seattle',
        province: 'Washington',
        zip: '98101',
        country: 'United States',
        countryCode: 'US',
        formatted: ['789 Northern Ave', 'Seattle, Washington 98101', 'United States'],
    },
    'loc-5': {
        address1: '55 Main Street',
        address2: 'Floor 2',
        city: 'New York',
        province: 'New York',
        zip: '10001',
        country: 'United States',
        countryCode: 'US',
        formatted: ['55 Main Street Floor 2', 'New York, New York 10001', 'United States'],
    },
};

const locationFulfillmentService = {
    __typename: 'FulfillmentService',
    id: 'fs-manual',
    serviceName: 'Manual',
};

// Patch location addresses
[loc1, loc2, loc3, loc4, loc5].forEach((loc) => {
    const a = locationAddresses[loc.id];
    if (a) {
        Object.assign(loc.address, a);
    }
    (loc as any).fulfillmentService = locationFulfillmentService;
});

export const loc2WithFormatted = loc2;
// formatted addresses come from locationAddresses (realistic, applied above)

export const allLocations = [loc1, loc2, loc3, loc4, loc5];
export const locationById = new Map(allLocations.map((l) => [l.id, l]));

// ---------------------------------------------------------------------------
// Customers (Shopify customers — different from Linear customers)
// ---------------------------------------------------------------------------
function mkCustomer(
    id: string,
    displayName: string,
    email: string,
    opts: Record<string, any> = {},
) {
    const seed = h(`Customer#${id}`);
    const cAddr1 = streetAddress(`Customer.addr#${id}`);
    const cCity = pick(CITIES, `Customer.city#${id}`);
    const [cPc, cProv] = province(`Customer.prov#${id}`);
    const cZip = zipCode(`Customer.zip#${id}`);
    return {
        __typename: 'Customer',
        id,
        _seed: seed,
        displayName,
        email,
        numberOfOrders: String((h(`Customer.numberOfOrders#${seed}`) % 40) + 1),
        amountSpent: money(amount(`Customer.amountSpent#${seed}`), opts.currency ?? 'USD'),
        taxExempt: opts.taxExempt ?? false,
        taxExemptions: opts.taxExemptions ?? [],
        defaultAddress: {
            id: `gid://shopify/MailingAddress/${h(`Customer.defaultAddress#${seed}`) % 100000}`,
            address1: cAddr1,
            address2: null,
            city: cCity,
            province: cProv,
            provinceCode: cPc,
            country: 'United States',
            zip: cZip,
            phone: null,
            name: displayName,
            formatted: formattedAddress(cAddr1, cCity, cPc, cZip),
        },
        defaultEmailAddress: {
            emailAddress: opts.emailAddress ?? emailAddr(`Customer.emailAddress#${id}`),
            marketingState: opts.marketingState ?? 'SUBSCRIBED',
            marketingUpdatedAt: opts.marketingUpdatedAt ?? '2024-01-15T00:00:00.000Z',
        },
        market: opts.market ?? {
            __typename: 'Market',
            id: 'mkt-1',
            name: 'US Market',
            priceList: { id: 'pl-1', name: 'US Price List', currencyCode: 'USD', currency: 'USD' },
            priceInclusions: { inclusiveTaxPricingStrategy: 'ADD_TAXES_AT_CHECKOUT' },
        },
        subscriptionContracts: {
            nodes: [],
            edges: [],
            totalCount: 0,
            pageInfo: {
                hasNextPage: false,
                hasPreviousPage: false,
                startCursor: null,
                endCursor: null,
            },
        },
        addressesV2: [] as any[],
        storeCreditAccounts: [] as any[],
        paymentMethods: [] as any[],
        orders: [] as any[],
        events: [] as any[],
        customerJourneySummary: opts.customerJourneySummary ?? null,
        ...opts,
    };
}

// The 5 main customers (used in shop-045, shop-049, shop-051, shop-052, shop-053, etc.)
export const cust1 = mkCustomer('cust-1', 'Amelia Lopez', 'emma.w.shopping@example.com', {
    taxExempt: true,
    taxExemptions: ['US_HI_RESELLER_EXEMPTION', 'CA_NS_FARMER_EXEMPTION'],
    defaultAddress: {
        address1: '412 Main Street',
        city: 'San Antonio',
        province: 'California',
        provinceCode: 'CA',
    },
    emailAddress: 'newsletter@example.com',
    customerJourneySummary: { lastVisit: { source: 'email_campaign', sourceType: 'RETARGETING' } },
});
export const cust2 = mkCustomer('cust-2', 'Harper Young', 'olivia.m.buyer@example.com', {
    taxExempt: true,
    taxExemptions: ['US_NE_RESELLER_EXEMPTION', 'US_WV_RESELLER_EXEMPTION'],
    defaultAddress: {
        address1: '815 Second Avenue',
        city: 'San Diego',
        province: 'Texas',
        provinceCode: 'TX',
    },
    emailAddress: 'alternate.email@example.com',
    customerJourneySummary: { lastVisit: { source: 'direct', sourceType: 'AD' } },
});
export const cust3 = mkCustomer('cust-3', 'Logan Robinson', 'sophia.a.client@example.com', {
    taxExempt: false,
    taxExemptions: ['US_WY_RESELLER_EXEMPTION', 'CA_MB_RESELLER_EXEMPTION'],
    defaultAddress: {
        address1: '621 Third Boulevard',
        city: 'Philadelphia',
        province: 'Florida',
        provinceCode: 'FL',
    },
    emailAddress: 'notifications@example.com',
    customerJourneySummary: { lastVisit: { source: 'organic_search', sourceType: 'NOTIFICATION' } },
});
export const cust4 = mkCustomer('cust-4', 'Michael Chen', 'david.t.shopper@example.com', {
    taxExempt: false,
    taxExemptions: ['US_CT_RESELLER_EXEMPTION', 'CA_MB_FARMER_EXEMPTION'],
    defaultAddress: {
        address1: '734 Fourth Lane',
        city: 'Los Angeles',
        province: 'New York',
        provinceCode: 'NY',
    },
    emailAddress: 'promo.emails@example.com',
    customerJourneySummary: { lastVisit: { source: 'social_media', sourceType: 'AD' } },
});
export const cust5 = mkCustomer('cust-5', 'Benjamin Clark', 'james.r.customer@example.com', {
    taxExempt: false,
    taxExemptions: ['US_HI_RESELLER_EXEMPTION', 'US_CO_RESELLER_EXEMPTION'],
    defaultAddress: {
        address1: '529 Fifth Street',
        city: 'Dallas',
        province: 'Pennsylvania',
        provinceCode: 'PA',
    },
    emailAddress: 'backup.email@example.com',
    customerJourneySummary: { lastVisit: { source: 'referral', sourceType: 'RETARGETING' } },
});

// Customer gid://shopify/Object/1 (used in shop-041, shop-048, shop-054)
export const custObj1 = mkCustomer(
    'gid://shopify/Object/1',
    'David Thompson',
    'michael.c.orders@example.com',
    {
        currency: 'AMD',
        amountSpent: money('78.99', 'AMD'),
        numberOfOrders: '8',
        taxExempt: false,
        taxExemptions: [],
        emailAddress: 'contact.primary@example.com',
        customerJourneySummary: null,
    },
);

// Customer gid://shopify/Customer/1
export const custCust1 = mkCustomer(
    'gid://shopify/Customer/1',
    'Abigail Adams',
    'sarah.j.2024@example.com',
    {
        taxExempt: false,
        taxExemptions: [],
    },
);

// 2 customers with UNSUBSCRIBED marketing state (shop-044)
export const custUnsub1 = mkCustomer(
    'cust-unsub-1',
    'Grace Whitfield',
    'grace.whitfield@mailbox.test',
    {
        emailAddress: 'grace.whitfield@mailbox.test',
        marketingState: 'UNSUBSCRIBED',
        taxExempt: false,
        taxExemptions: [],
    },
);
export const custUnsub2 = mkCustomer(
    'cust-unsub-2',
    'Owen Castellano',
    'owen.castellano@inbox.example',
    {
        emailAddress: 'owen.castellano@inbox.example',
        marketingState: 'UNSUBSCRIBED',
        taxExempt: false,
        taxExemptions: [],
    },
);

// 5 customers with >5 orders (shop-051 orders_count:>5)
// re-use cust1..cust5 for that filter

// Storefront credit accounts for cust1..cust5 (shop-045)
cust1.storeCreditAccounts = [
    { balance: money('145.00', 'LTL') },
    { balance: money('97.25', 'CAD') },
];
cust2.storeCreditAccounts = [
    { balance: money('82.75', 'KGS') },
    { balance: money('72.50', 'TRY') },
];
cust3.storeCreditAccounts = [
    { balance: money('69.00', 'XXX') },
    { balance: money('31.00', 'MRU') },
];
cust4.storeCreditAccounts = [
    { balance: money('168.50', 'ZMW') },
    { balance: money('61.25', 'HTG') },
];
cust5.storeCreditAccounts = [
    { balance: money('42.50', 'HKD') },
    { balance: money('13.99', 'STN') },
];

// Payment methods for gid://shopify/Customer/1 (shop-055)
custCust1.paymentMethods = [
    {
        id: 'pm-1',
        revokedAt: null,
        instrument: {
            __typename: 'CustomerCreditCard',
            brand: 'Mastercard',
            lastDigits: '1111',
            maskedNumber: '****-****-****-1111',
            expiryMonth: 9,
            expiryYear: 2026,
        },
    },
    {
        id: 'pm-2',
        revokedAt: null,
        instrument: {
            __typename: 'CustomerCreditCard',
            brand: 'Visa',
            lastDigits: '4242',
            maskedNumber: '****-****-****-4242',
            expiryMonth: 12,
            expiryYear: 2027,
        },
    },
];

// Addresses for gid://shopify/Customer/1 (shop-047)
custCust1.addressesV2 = [
    {
        id: 'gid://shopify/MailingAddress/addr-1',
        address1: '357 Seventh Road',
        address2: 'Apt 3B',
        city: 'New York',
        province: 'California',
        provinceCode: 'CA',
        country: 'United States',
        zip: '10001',
        phone: null,
        name: 'Abigail Adams',
        formatted: ['357 Seventh Road Apt 3B', 'New York, CA 10001', 'United States'],
    },
    {
        id: 'gid://shopify/MailingAddress/addr-2',
        address1: '648 Sixth Avenue',
        address2: null,
        city: 'Los Angeles',
        province: 'Texas',
        provinceCode: 'TX',
        country: 'United States',
        zip: '90001',
        phone: null,
        name: 'Abigail Adams',
        formatted: ['648 Sixth Avenue', 'Los Angeles, TX 90001', 'United States'],
    },
];
custCust1.defaultAddress = {
    id: 'gid://shopify/MailingAddress/addr-default',
    address1: '482 Eighth Way',
    address2: null,
    city: 'Chicago',
    province: 'Florida',
    provinceCode: 'FL',
    country: 'United States',
    zip: '60601',
    phone: null,
    name: 'Abigail Adams',
    formatted: ['482 Eighth Way', 'Chicago, FL 60601', 'United States'],
};

// Comment events for custObj1 (shop-048)
const commentEvent1 = {
    __typename: 'CommentEvent',
    id: 'gid://shopify/CommentEvent/1',
    message: 'Product back in stock notification sent',
    rawMessage: 'Please add a gift message with hearts and stars',
    createdAt: '2024-07-30T00:00:00.000Z',
    author: {
        __typename: 'StaffMember',
        id: 'gid://shopify/StaffMember/1',
        name: 'James Rodriguez',
        email: 'james.rodriguez@example-shop.com',
    },
};
const commentEvent2 = {
    __typename: 'CommentEvent',
    id: 'gid://shopify/CommentEvent/2',
    message: 'Customer requested expedited shipping on order #1042',
    rawMessage: 'Size XL seems to run small based on reviews',
    createdAt: '2025-03-09T00:00:00.000Z',
    author: {
        __typename: 'StaffMember',
        id: 'gid://shopify/StaffMember/2',
        name: 'Sarah Mitchell',
        email: 'sarah.mitchell@example-shop.com',
    },
};
custObj1.events = [commentEvent1, commentEvent2];

export const allMainCustomers = [cust1, cust2, cust3, cust4, cust5];
export const customerById = new Map([
    ['gid://shopify/Object/1', custObj1],
    ['gid://shopify/Customer/1', custCust1],
    ...allMainCustomers.map((c: any) => [c.id, c] as [string, any]),
    [custUnsub1.id, custUnsub1],
    [custUnsub2.id, custUnsub2],
]);

// ---------------------------------------------------------------------------
// InventoryItems / InventoryLevels (for shop-028)
// ---------------------------------------------------------------------------
let _invLevelCounter = 1;
function mkInvLevel(locationObj: any, quantities: Array<{ name: string; quantity: number }>) {
    const id = `gid://shopify/InventoryLevel/${_invLevelCounter++}`;
    return {
        __typename: 'InventoryLevel',
        id,
        location: locationObj,
        quantities,
        scheduledChanges: [] as any[],
    };
}

const invLevel1a = mkInvLevel(loc1, [
    { name: 'PA Facility', quantity: 715 },
    { name: 'TX Storage', quantity: 930 },
]);
const invLevel1b = mkInvLevel(loc2, [
    { name: 'IL Center', quantity: 848 },
    { name: 'NV Depot', quantity: 532 },
]);
const invLevel2a = mkInvLevel(loc3, [
    { name: 'GA Warehouse', quantity: 289 },
    { name: 'MO Warehouse', quantity: 705 },
]);
const invLevel2b = mkInvLevel(loc4, [
    { name: 'AZ Storage', quantity: 848 },
    { name: 'WA Hub', quantity: 99 },
]);

// Inventory levels for locations (shop-040)
const locInvLevel1 = mkInvLevel(loc1, [
    { name: 'IL Center', quantity: 684 },
    { name: 'OH Depot', quantity: 701 },
    { name: 'GA Warehouse', quantity: 72 },
    { name: 'CA Distribution', quantity: 725 },
]);
const locInvLevel2 = mkInvLevel(loc2, [
    { name: 'OH Depot', quantity: 322 },
    { name: 'NV Depot', quantity: 724 },
    { name: 'CO Center', quantity: 880 },
    { name: 'AZ Storage', quantity: 331 },
]);
const locInvLevel3 = mkInvLevel(loc3, [
    { name: 'GA Warehouse', quantity: 226 },
    { name: 'WA Hub', quantity: 803 },
    { name: 'FL Hub', quantity: 121 },
    { name: 'TX Storage', quantity: 686 },
]);
const locInvLevel4 = mkInvLevel(loc4, [
    { name: 'NV Depot', quantity: 995 },
    { name: 'NV Depot', quantity: 711 },
    { name: 'NV Depot', quantity: 185 },
    { name: 'NV Depot', quantity: 674 },
]);
const locInvLevel5 = mkInvLevel(loc5, [
    { name: 'NY Warehouse', quantity: 103 },
    { name: 'WA Hub', quantity: 638 },
    { name: 'MO Warehouse', quantity: 642 },
    { name: 'GA Warehouse', quantity: 373 },
]);
loc1.inventoryLevels = [locInvLevel1];
loc2.inventoryLevels = [locInvLevel2];
loc3.inventoryLevels = [locInvLevel3];
loc4.inventoryLevels = [locInvLevel4];
loc5.inventoryLevels = [locInvLevel5];

// ---------------------------------------------------------------------------
// Products and Variants
// ---------------------------------------------------------------------------
// Scheduled changes (for shop-095 — products 2, 3, 4 have scheduled changes on variant inventory)
function mkScheduledChange(id: string) {
    return {
        __typename: 'InventoryScheduledChange',
        expectedAt: `2025-07-01T00:00:00.000Z`,
        fromName: 'available',
        toName: 'incoming',
    };
}
const sc1 = mkScheduledChange('sc-1');
const sc2 = mkScheduledChange('sc-2');

function mkInventoryItem(id: string, levels: any[], scheduledLevels?: any[]) {
    return {
        __typename: 'InventoryItem',
        id,
        _seed: h(`InventoryItem#${id}`),
        inventoryLevels: levels,
    };
}

// Variants — product back-ref is set lazily after product creation
function mkVariant(
    id: string,
    sku: string,
    price: string,
    cmpPrice: string | null,
    barcode: string,
    invQty: number,
    invItem: any,
    opts: Record<string, any> = {},
) {
    return {
        __typename: 'ProductVariant',
        id,
        _seed: h(`ProductVariant#${id}`),
        sku,
        price,
        compareAtPrice: cmpPrice,
        barcode,
        inventoryQuantity: invQty,
        title: opts.title ?? 'Default Title',
        inventoryItem: invItem,
        product: null as any, // will be set after product creation
        ...opts,
    };
}

// Product 1: title-4925, ARCHIVED, vendor:Acme, tag:eco-friendly, tracksInventory:true, totalInventory:305
// variants: empty (shop-022 shows product 1 has empty variantInventoryQuantities)
const invItem_p1 = mkInventoryItem('inv-p1', [invLevel1a, invLevel1b]);
const var_p1_1 = mkVariant('var-p1-1', 'FSGH8Q38', '19.95', null, 'BARCODE-p1-1', 305, invItem_p1);
const var_p1_sale = mkVariant(
    'var-p1-sale',
    'PHC-BLK-STD',
    '61.14',
    '63.21',
    'BARCODE-sale1',
    100,
    invItem_p1,
);

// Product 2: title-9753, ARCHIVED, vendor:Acme, tag:eco-friendly, tracksInventory:true, totalInventory:581
// has media with PROCESSING status, has scheduled inventory changes
const invItem_p2 = mkInventoryItem('inv-p2', [invLevel2a, invLevel2b]);
const var_p2_1 = mkVariant('var-p2-1', '6A0QSGTS', '256.00', null, 'BARCODE-p2-1', 908, invItem_p2);
const var_p2_2 = mkVariant(
    'var-p2-2',
    'LWL-BRN-BIF',
    '334.69',
    null,
    'BARCODE-p2-2',
    945,
    invItem_p2,
);
const var_p2_3 = mkVariant(
    'var-p2-3',
    'LWL-BLK-BIF',
    '61.14',
    null,
    'BARCODE-p2-3',
    474,
    invItem_p2,
);
const var_p2_4 = mkVariant(
    'var-p2-4',
    'LWL-TAN-TRI',
    '360.70',
    null,
    'BARCODE-p2-4',
    542,
    invItem_p2,
);
const var_p2_5 = mkVariant(
    'var-p2-5',
    'LWL-BRN-TRI',
    '401.63',
    null,
    'BARCODE-p2-5',
    104,
    invItem_p2,
);
// Add scheduled changes to invItem_p2 levels
(invLevel2a as any).scheduledChanges = [sc1];

const var_p2_sale = mkVariant(
    'var-p2-sale',
    'LWL-BLK-SLM',
    '472.56',
    '239.48',
    'BARCODE-sale2',
    50,
    invItem_p2,
);

// Product 3: title-2694, DRAFT, vendor:Acme, tag:eco-friendly, tracksInventory:false, totalInventory:754, hasVariantsThatRequiresComponents:true
const invItem_p3 = mkInventoryItem('inv-p3', []);
const var_p3_1 = mkVariant(
    'var-p3-1',
    'WHP-BLK-OE',
    '159.99',
    null,
    'BARCODE-p3-1',
    776,
    invItem_p3,
);
const var_p3_2 = mkVariant(
    'var-p3-2',
    'WHP-WHT-OE',
    '391.80',
    null,
    'BARCODE-p3-2',
    733,
    invItem_p3,
);
const var_p3_3 = mkVariant(
    'var-p3-3',
    'WHP-BLU-OE',
    '437.39',
    null,
    'BARCODE-p3-3',
    296,
    invItem_p3,
);
const var_p3_4 = mkVariant(
    'var-p3-4',
    'WHP-BLK-IE',
    '446.97',
    null,
    'BARCODE-p3-4',
    692,
    invItem_p3,
);
const var_p3_5 = mkVariant(
    'var-p3-5',
    'WHP-RED-IE',
    '31.12',
    null,
    'BARCODE-p3-5',
    985,
    invItem_p3,
);
(invItem_p3 as any).inventoryLevels = [{ ...locInvLevel3, scheduledChanges: [sc2] }];
const var_p3_sale = mkVariant(
    'var-p3-sale',
    'WHP-BLK-PRO',
    '177.36',
    '175.79',
    'BARCODE-sale3',
    80,
    invItem_p3,
);

// Product 4: title-6100, ACTIVE, vendor:Acme, tag:eco-friendly, tracksInventory:false, totalInventory:720, hasVariantsThatRequiresComponents:true
const invItem_p4 = mkInventoryItem('inv-p4', []);
const var_p4_1 = mkVariant(
    'var-p4-1',
    'YMT-PUR-4MM',
    '42.00',
    null,
    'BARCODE-p4-1',
    678,
    invItem_p4,
);
const var_p4_2 = mkVariant(
    'var-p4-2',
    'YMT-BLU-4MM',
    '447.93',
    null,
    'BARCODE-p4-2',
    253,
    invItem_p4,
);
const var_p4_3 = mkVariant(
    'var-p4-3',
    'YMT-GRN-6MM',
    '457.84',
    null,
    'BARCODE-p4-3',
    58,
    invItem_p4,
);
const var_p4_4 = mkVariant(
    'var-p4-4',
    'YMT-PNK-6MM',
    '98.25',
    null,
    'BARCODE-p4-4',
    268,
    invItem_p4,
);
const var_p4_5 = mkVariant(
    'var-p4-5',
    'YMT-GRY-8MM',
    '384.45',
    null,
    'BARCODE-p4-5',
    728,
    invItem_p4,
);
(invItem_p4 as any).inventoryLevels = [{ ...locInvLevel4, scheduledChanges: [sc1] }];
const var_p4_sale = mkVariant(
    'var-p4-sale',
    'YMT-BLK-PRO',
    '227.00',
    '179.35',
    'BARCODE-sale4',
    60,
    invItem_p4,
);

// Product 5: title-9893, ARCHIVED, vendor:Acme, tag:eco-friendly, tracksInventory:true, totalInventory:641
// empty variants in shop-022
const invItem_p5 = mkInventoryItem('inv-p5', []);
const var_p5_1 = mkVariant(
    'var-p5-1',
    'SWT-BLK-42',
    '119.50',
    null,
    'BARCODE-p5-1',
    641,
    invItem_p5,
);
const var_p5_sale = mkVariant(
    'var-p5-sale',
    'SWT-SLV-46',
    '329.86',
    '472.61',
    'BARCODE-sale5',
    40,
    invItem_p5,
);

// All sale variants (for shop-029: is_price_reduced:true -> 15 variants)
// We need 15 sale variants total. We have 5 so far. Let's add 10 more across products.
const salePairs: Array<{ sku: string; price: string; cmpPrice: string }> = [
    { sku: 'PHC-CLR-STD', price: '247.27', cmpPrice: '94.57' },
    { sku: 'LWL-BLK-SLM2', price: '139.55', cmpPrice: '359.64' },
    { sku: 'WHP-WHT-PRO', price: '72.30', cmpPrice: '80.12' },
    { sku: 'YMT-TEA-6MM', price: '451.44', cmpPrice: '92.31' },
    { sku: 'SWT-GLD-46', price: '423.33', cmpPrice: '251.73' },
    { sku: 'PHC-NVY-STD', price: '480.75', cmpPrice: '230.55' },
    { sku: 'LWL-TAN-BIF', price: '234.97', cmpPrice: '149.13' },
    { sku: 'WHP-BLU-PRO', price: '110.07', cmpPrice: '432.92' },
    { sku: 'YMT-ORG-8MM', price: '446.68', cmpPrice: '273.11' },
    { sku: 'SWT-RSE-42', price: '340.36', cmpPrice: '87.39' },
];
const extraSaleVariants = salePairs.map((sp, i) =>
    mkVariant(
        `var-extra-sale-${i}`,
        sp.sku,
        sp.price,
        sp.cmpPrice,
        `BARCODE-extra-${i}`,
        20,
        invItem_p1,
    ),
);

// All sale variants (15 total matching shop-029)
export const allSaleVariants = [
    var_p1_sale,
    var_p2_sale,
    var_p3_sale,
    var_p4_sale,
    var_p5_sale,
    ...extraSaleVariants,
];

// Metafields for products (shop-033)
const meta_p1 = [
    { namespace: 'marketing', key: 'custom_field_1', value: 'Configuration setting' },
    { namespace: 'custom', key: 'custom_field_1', value: 'Customer note' },
];
const meta_p2 = [
    { namespace: 'inventory', key: 'product_details', value: 'Internal comment' },
    { namespace: 'custom', key: 'shipping_info', value: 'Important information' },
];
const meta_p3 = [
    { namespace: 'social', key: 'header_label', value: 'Configuration setting' },
    { namespace: 'custom', key: 'page_title', value: 'Configuration setting' },
];
const meta_p4 = [
    { namespace: 'fulfillment', key: 'custom_field_1', value: 'Product specification' },
    { namespace: 'shipping', key: 'custom_field_1', value: 'Important information' },
];
const meta_p5 = [
    { namespace: 'shipping', key: 'page_title', value: 'Customer note' },
    { namespace: 'shipping', key: 'header_label', value: 'Important information' },
];

// Translations for products (shop-038)
const trans_p1 = [
    { key: 'tooltip.discount.applied', locale: 'es-ES', value: 'Featured Products This Week' },
    {
        key: 'message.order.confirmation',
        locale: 'zh-CN',
        value: 'Learn about our hassle-free returns and exchange policy here.',
    },
];
const trans_p2 = [
    {
        key: 'help.returns.policy',
        locale: 'pt-BR',
        value: 'Thank you for your order. You will receive a confirmation email shortly.',
    },
    {
        key: 'notification.sale.started',
        locale: 'nl-NL',
        value: '2024 Shopify Inc. All rights reserved.',
    },
];
const trans_p3 = [
    {
        key: 'heading.products.featured',
        locale: 'ja-JP',
        value: 'Expedited Shipping (2-3 business days)',
    },
    {
        key: 'error.payment.declined',
        locale: 'de-DE',
        value: 'Summer Sale Now Live - Up to 50% Off',
    },
];
const trans_p4 = [
    {
        key: 'label.shipping.expedited',
        locale: 'it-IT',
        value: 'Discount successfully applied to your order',
    },
    { key: 'placeholder.email.address', locale: 'ko-KR', value: 'Enter your email address' },
];
const trans_p5 = [
    { key: 'footer.company.copyright', locale: 'en-US', value: 'Proceed to Checkout' },
    {
        key: 'button.cart.checkout',
        locale: 'fr-CA',
        value: 'Your payment could not be processed. Please check your card details and try again.',
    },
];

// ResourcePublications for products (shop-037)
let _pubCounter = 100;
const mkPub = (pubName: string, isPublished: boolean) => {
    const pubId = `pub-rp-${_pubCounter++}`;
    return {
        publication: {
            id: pubId,
            name: pubName,
            title: pubName,
            catalog: {
                __typename: 'AppCatalog',
                id: `cat-rp-${pubId}`,
                title: `${pubName} Catalog`,
            },
        },
        isPublished,
        publishDate: null,
    };
};
const pubs_p1 = [
    mkPub('Mobile App', true),
    mkPub('Point of Sale', true),
    mkPub('Mobile App', false),
    mkPub('Mobile App', false),
    mkPub('Mobile App', false),
];
const pubs_p2 = [
    mkPub('Online Store', true),
    mkPub('Mobile App', false),
    mkPub('Point of Sale', false),
    mkPub('B2B Portal', true),
    mkPub('Point of Sale', false),
];
const pubs_p3 = [
    mkPub('B2B Portal', false),
    mkPub('Online Store', true),
    mkPub('B2B Portal', true),
    mkPub('B2B Portal', false),
    mkPub('B2B Portal', true),
];
const pubs_p4 = [
    mkPub('Mobile App', true),
    mkPub('B2B Portal', true),
    mkPub('Online Store', true),
    mkPub('Point of Sale', true),
    mkPub('Point of Sale', false),
];
const pubs_p5 = [
    mkPub('B2B Portal', false),
    mkPub('Online Store', false),
    mkPub('Mobile App', true),
    mkPub('B2B Portal', false),
    mkPub('B2B Portal', false),
];

function mkProduct(
    id: string,
    title: string,
    handle: string,
    status: string,
    opts: Record<string, any> = {},
) {
    const seed = h(`Product#${id}`);
    return {
        __typename: 'Product',
        id,
        _seed: seed,
        title,
        handle,
        status,
        vendor: opts.vendor ?? 'Acme',
        tags: opts.tags ?? ['eco-friendly'],
        totalInventory: opts.totalInventory ?? 0,
        tracksInventory: opts.tracksInventory ?? true,
        hasVariantsThatRequiresComponents: opts.hasVariantsThatRequiresComponents ?? false,
        updatedAt: opts.updatedAt ?? '2025-05-01T00:00:00.000Z',
        resourcePublicationsCount: { count: opts.pubCount ?? 0, precision: 'EXACT' },
        mediaCount: { count: opts.mediaCount ?? 2, precision: 'EXACT' },
        priceRangeV2: { maxVariantPrice: money(opts.maxPrice ?? '19.95', 'USD') },
        variants: opts.variants ?? [],
        media: opts.media ?? [],
        metafields: opts.metafields ?? [],
        options: opts.options ?? [
            {
                id: `gid://shopify/ProductOption/${h(`ProductOption#${id}-1`) % 100000}`,
                name: 'Size',
                values: ['S', 'M', 'L'],
            },
        ],
        translations: opts.translations ?? [],
        resourcePublications: opts.resourcePublications ?? [],
        // Deprecated publication fields — return same data as resourcePublications
        resourcePublicationsV2: opts.resourcePublicationsV2 ?? opts.resourcePublications ?? [],
        publications:
            opts.publications ??
            (opts.resourcePublications ?? []).map((rp: any) => ({
                channel: { id: 'chan-1', name: rp.publication?.name ?? 'Online Store' },
                isPublished: rp.isPublished,
                publishDate: null,
            })),
        productPublications:
            opts.productPublications ??
            (opts.resourcePublications ?? []).map((rp: any) => ({
                channel: { id: 'chan-1', name: rp.publication?.name ?? 'Online Store' },
                isPublished: rp.isPublished,
                publishDate: null,
            })),
        unpublishedChannels: opts.unpublishedChannels ?? [],
        ...opts,
    };
}

// Media helper — MediaImage is the concrete type implementing Media interface
let _mediaCounter = 1;
const mkMedia = (status: string) => {
    const mid = _mediaCounter++;
    return {
        __typename: 'MediaImage',
        id: `gid://shopify/MediaImage/${mid}`,
        _seed: h(`MediaImage#${mid}`),
        status,
        alt: null,
        mediaContentType: 'IMAGE',
    };
};

export const prod1 = mkProduct('prod-1', 'Phone Case', 'prod-1-handle', 'ARCHIVED', {
    totalInventory: 305,
    tracksInventory: true,
    hasVariantsThatRequiresComponents: false,
    updatedAt: '2025-05-01T00:00:00.000Z',
    pubCount: 71,
    variants: [var_p1_1],
    media: [mkMedia('UPLOADED'), mkMedia('UPLOADED')],
    metafields: meta_p1,
    translations: trans_p1,
    resourcePublications: pubs_p1,
    priceRangeV2: { maxVariantPrice: money('19.95', 'USD') },
});
export const prod2 = mkProduct('prod-2', 'Leather Wallet', 'prod-2-handle', 'ARCHIVED', {
    totalInventory: 581,
    tracksInventory: true,
    hasVariantsThatRequiresComponents: false,
    updatedAt: '2025-05-01T00:00:00.000Z',
    pubCount: 518,
    variants: [var_p2_1, var_p2_2, var_p2_3, var_p2_4, var_p2_5],
    media: [mkMedia('PROCESSING'), mkMedia('UPLOADED')],
    metafields: meta_p2,
    translations: trans_p2,
    resourcePublications: pubs_p2,
    priceRangeV2: { maxVariantPrice: money('256.00', 'USD') },
});
export const prod3 = mkProduct('prod-3', 'Wireless Headphones', 'prod-3-handle', 'DRAFT', {
    totalInventory: 754,
    tracksInventory: false,
    hasVariantsThatRequiresComponents: true,
    updatedAt: '2025-05-01T00:00:00.000Z',
    pubCount: 515,
    variants: [var_p3_1, var_p3_2, var_p3_3, var_p3_4, var_p3_5],
    media: [mkMedia('PROCESSING'), mkMedia('UPLOADED')],
    metafields: meta_p3,
    translations: trans_p3,
    resourcePublications: pubs_p3,
    priceRangeV2: { maxVariantPrice: money('159.99', 'USD') },
});
export const prod4 = mkProduct('prod-4', 'Yoga Mat', 'prod-4-handle', 'ACTIVE', {
    totalInventory: 720,
    tracksInventory: false,
    hasVariantsThatRequiresComponents: true,
    updatedAt: '2025-05-01T00:00:00.000Z',
    pubCount: 75,
    variants: [var_p4_1, var_p4_2, var_p4_3, var_p4_4, var_p4_5],
    media: [mkMedia('PROCESSING'), mkMedia('UPLOADED')],
    metafields: meta_p4,
    translations: trans_p4,
    resourcePublications: pubs_p4,
    priceRangeV2: { maxVariantPrice: money('42.00', 'USD') },
});
export const prod5 = mkProduct('prod-5', 'Smart Watch', 'prod-5-handle', 'ARCHIVED', {
    totalInventory: 641,
    tracksInventory: true,
    hasVariantsThatRequiresComponents: false,
    updatedAt: '2025-05-01T00:00:00.000Z',
    pubCount: 880,
    variants: [var_p5_1],
    media: [mkMedia('UPLOADED'), mkMedia('UPLOADED')],
    metafields: meta_p5,
    translations: trans_p5,
    resourcePublications: pubs_p5,
    priceRangeV2: { maxVariantPrice: money('119.50', 'USD') },
});

export const allProducts = [prod1, prod2, prod3, prod4, prod5];
export const productById = new Map(allProducts.map((p) => [p.id, p]));
export const allProductVariants = [
    var_p1_1,
    var_p2_1,
    var_p2_2,
    var_p2_3,
    var_p2_4,
    var_p2_5,
    var_p3_1,
    var_p3_2,
    var_p3_3,
    var_p3_4,
    var_p3_5,
    var_p4_1,
    var_p4_2,
    var_p4_3,
    var_p4_4,
    var_p4_5,
    var_p5_1,
];

// Back-link variants → product
[
    [prod1, [var_p1_1, var_p1_sale]],
    [prod2, [var_p2_1, var_p2_2, var_p2_3, var_p2_4, var_p2_5, var_p2_sale]],
    [prod3, [var_p3_1, var_p3_2, var_p3_3, var_p3_4, var_p3_5, var_p3_sale]],
    [prod4, [var_p4_1, var_p4_2, var_p4_3, var_p4_4, var_p4_5, var_p4_sale]],
    [prod5, [var_p5_1, var_p5_sale]],
].forEach(([prod, variants]) => {
    (variants as any[]).forEach((v) => {
        v.product = prod;
    });
});

// ---------------------------------------------------------------------------
// Collections
// ---------------------------------------------------------------------------
// "summer-collection" handle (shop-024)
const summerCollProd1 = mkProduct('col-prod-1', 'USB Cable', 'col-prod-1-handle', 'ACTIVE', {
    updatedAt: '2024-10-24T00:00:00.000Z',
    vendor: 'Acme',
    tags: [],
    totalInventory: 100,
    variants: [],
    media: [],
    metafields: [],
    translations: [],
    resourcePublications: [],
});
const summerCollProd2 = mkProduct('col-prod-2', 'USB Cable', 'col-prod-2-handle', 'ACTIVE', {
    updatedAt: '2025-02-11T00:00:00.000Z',
    vendor: 'Acme',
    tags: [],
    totalInventory: 50,
    variants: [],
    media: [],
    metafields: [],
    translations: [],
    resourcePublications: [],
});

export const collSummer: any = {
    __typename: 'Collection',
    id: 'col-summer',
    _seed: h('Collection#col-summer'),
    title: 'Summer Essentials',
    handle: 'summer-collection',
    ruleSet: { appliedDisjunctively: false, rules: [] },
    productsCount: { count: 2, precision: 'EXACT' },
    products: [summerCollProd1, summerCollProd2],
};

// "navy-hoodie" handle (shop-025)
export const navyHoodieProduct: any = mkProduct(
    'prod-navy',
    'Navy Pullover Hoodie',
    'navy-hoodie',
    'ACTIVE',
    {
        totalInventory: 50,
        variants: [
            mkVariant('var-navy-1', 'INAMZOTU', '345.22', null, 'BARCODE-navy-1', 20, invItem_p1),
            mkVariant('var-navy-2', 'DLPD6SY6', '385.14', null, 'BARCODE-navy-2', 15, invItem_p1),
            mkVariant('var-navy-3', '2GVOHNG2', '490.49', null, 'BARCODE-navy-3', 5, invItem_p1),
            mkVariant('var-navy-4', '2Q7C48I6', '383.60', null, 'BARCODE-navy-4', 7, invItem_p1),
            mkVariant('var-navy-5', 'THT185XE', '60.36', null, 'BARCODE-navy-5', 3, invItem_p1),
        ],
        media: [],
        metafields: [],
        translations: [],
        resourcePublications: [],
    },
);

// 2 collections for shop-031, shop-032
export const coll1: any = {
    __typename: 'Collection',
    id: 'coll-1',
    _seed: h('Collection#coll-1'),
    title: 'Summer Sale Collection',
    handle: 'coll-1-handle',
    ruleSet: {
        appliedDisjunctively: true,
        rules: [
            {
                column: 'VARIANT_TITLE',
                condition: 'Vendor equals Acme Corp',
                relation: 'NOT_CONTAINS',
                conditionObject: { __typename: 'CollectionRuleTextCondition', value: 'Acme Corp' },
            },
            {
                column: 'VARIANT_COMPARE_AT_PRICE',
                condition: 'Tag contains organic',
                relation: 'IS_NOT_SET',
                conditionObject: { __typename: 'CollectionRuleTextCondition', value: 'organic' },
            },
        ],
    },
    productsCount: { count: 712, precision: 'EXACT' },
    products: allProducts,
};
export const coll2: any = {
    __typename: 'Collection',
    id: 'coll-2',
    _seed: h('Collection#coll-2'),
    title: 'Best Sellers',
    handle: 'coll-2-handle',
    ruleSet: {
        appliedDisjunctively: false,
        rules: [
            {
                column: 'VARIANT_PRICE',
                condition: 'Price greater than 50',
                relation: 'CONTAINS',
                conditionObject: { __typename: 'CollectionRuleTextCondition', value: '50' },
            },
            {
                column: 'PRODUCT_CATEGORY_ID',
                condition: 'Product type is Apparel',
                relation: 'STARTS_WITH',
                conditionObject: { __typename: 'CollectionRuleTextCondition', value: 'Apparel' },
            },
        ],
    },
    productsCount: { count: 444, precision: 'EXACT' },
    products: allProducts,
};
export const allCollections = [coll1, coll2];
export const collectionByHandle = new Map([['summer-collection', collSummer]]);

// ---------------------------------------------------------------------------
// Orders (5 main + 3 special)
// ---------------------------------------------------------------------------
// LineItems
function mkLineItem(
    id: string,
    name: string,
    qty: number,
    unfulfilledQty: number,
    isGiftCard = false,
) {
    return {
        __typename: 'LineItem',
        id,
        _seed: h(`LineItem#${id}`),
        name,
        title: name,
        quantity: qty,
        unfulfilledQuantity: unfulfilledQty,
        isGiftCard,
        giftCard: isGiftCard,
        customAttributes: [],
    };
}
// LineItems for order 0 (name-7778): empty
// LineItems for order 1 (name-9442): 5
const li_o1 = [
    mkLineItem('li-o1-1', 'Set L', 507, 889),
    mkLineItem('li-o1-2', 'Package J', 160, 974, true),
    mkLineItem('li-o1-3', 'Series N', 743, 189),
    mkLineItem('li-o1-4', 'Range O', 753, 47),
    mkLineItem('li-o1-5', 'Package J', 928, 638, true),
];
// LineItems for order 2 (name-1532): 5
const li_o2 = [
    mkLineItem('li-o2-1', 'Bundle K', 805, 55),
    mkLineItem('li-o2-2', 'Package J', 575, 181),
    mkLineItem('li-o2-3', 'Package J', 709, 999),
    mkLineItem('li-o2-4', 'Item B', 709, 847),
    mkLineItem('li-o2-5', 'Container I', 567, 881),
];
// LineItems for order 3 (name-547): 5
const li_o3 = [
    mkLineItem('li-o3-1', 'Stock H', 539, 141),
    mkLineItem('li-o3-2', 'Collection M', 177, 419),
    mkLineItem('li-o3-3', 'Range O', 273, 407),
    mkLineItem('li-o3-4', 'Collection M', 734, 740, true),
    mkLineItem('li-o3-5', 'Bundle K', 816, 114, true),
];
// LineItems for order 4 (name-2172): empty

// Refunds
function mkRefundSimple(amounts: string[]) {
    return amounts.map((a, i) => ({
        __typename: 'Refund',
        id: `refund-${a}`,
        _seed: h(`Refund#${a}`),
        totalRefundedSet: moneyBag(a, 'USD'),
        totalRefunded: money(a, 'USD'),
        createdAt: '2025-05-01T00:00:00.000Z',
        refundLineItems: [],
    }));
}

const refunds_o0 = mkRefundSimple(['55.00', '151.75', '139.50', '165.00', '155.00']);
const refunds_o1 = mkRefundSimple(['299.99', '13.95', '88.50', '129.00', '33.75']);
const refunds_o2 = mkRefundSimple(['250.00', '107.50', '250.00', '28.99', '144.99']);
const refunds_o3 = mkRefundSimple(['61.50', '112.50', '24.95', '5.99', '11.99']);
const refunds_o4 = mkRefundSimple(['39.75', '56.75', '63.25', '12.25', '199.99']);

// FulfillmentOrderDestinations
function mkFODest(pairs: Array<[string, string, string, string]>) {
    return pairs.map(([a1, city, fn, ln]) => ({
        __typename: 'FulfillmentOrderDestination',
        address1: a1,
        city,
        firstName: fn,
        lastName: ln,
    }));
}
const foDest_o0 = mkFODest([
    ['999 Tamarack Court', 'Las Vegas', 'Sarah', 'Gonzalez'],
    ['901 Walnut Drive', 'San Antonio', 'Mary', 'Lee'],
    ['910 Poplar Avenue', 'Baltimore', 'Elizabeth', 'Perez'],
    ['1842 Maple Avenue', 'New Orleans', 'Karen', 'Harris'],
    ['777 Dogwood Way', 'Dallas', 'William', 'Thomas'],
]);
const foDest_o1 = mkFODest([
    ['456 Elm Street', 'Philadelphia', 'Lisa', 'Hernandez'],
    ['111 Willow Drive', 'Los Angeles', 'Margaret', 'Jones'],
    ['666 Mimosa Avenue', 'Nashville', 'Daniel', 'Garcia'],
    ['55 King Street West', 'Seattle', 'Michael', 'Rodriguez'],
    ['123 Hazel Street', 'Atlanta', 'David', 'Martinez'],
]);
const foDest_o2 = mkFODest([
    ['888 Sweetgum Drive', 'Miami', 'Jessica', 'Brown'],
    ['890 Hickory Lane', 'Portland', 'Patricia', 'Martin'],
    ['333 Linden Street', 'Columbus', 'Barbara', 'Johnson'],
    ['555 Magnolia Road', 'Detroit', 'Richard', 'Lopez'],
    ['247 Park Place', 'Denver', 'Nancy', 'Miller'],
]);
const foDest_o3 = mkFODest([
    ['567 Ash Court', 'Houston', 'Dorothy', 'Wilson'],
    ['678 Sycamore Place', 'Chicago', 'Charles', 'White'],
    ['678 Birch Avenue', 'Fort Worth', 'James', 'Anderson'],
    ['102 Oak Boulevard', 'Phoenix', 'Jennifer', 'Davis'],
    ['345 Chestnut Road', 'Boston', 'Ashley', 'Williams'],
]);
const foDest_o4 = mkFODest([
    ['234 Spruce Way', 'Minneapolis', 'Donna', 'Taylor'],
    ['222 Cottonwood Court', 'Jacksonville', 'Linda', 'Moore'],
    ['333 Pine Road', 'San Diego', 'Robert', 'Smith'],
    ['789 Cedar Lane', 'San Jose', 'Susan', 'Thompson'],
    ['444 Laurel Lane', 'Austin', 'Christopher', 'Jackson'],
]);

// FulfillmentHolds per order (10 each, shop-020)
const holdReasons_o0 = [
    'AWAITING_RETURN_ITEMS',
    'HIGH_RISK_OF_FRAUD',
    'INVENTORY_OUT_OF_STOCK',
    'INCORRECT_ADDRESS',
    'OTHER',
    'UNKNOWN_DELIVERY_DATE',
    'AWAITING_PAYMENT',
    'HIGH_RISK_OF_FRAUD',
    'OTHER',
    'ONLINE_STORE_POST_PURCHASE_CROSS_SELL',
];
const holdReasons_o1 = [
    'INVENTORY_OUT_OF_STOCK',
    'AWAITING_PAYMENT',
    'AWAITING_RETURN_ITEMS',
    'OTHER',
    'INVENTORY_OUT_OF_STOCK',
    'AWAITING_PAYMENT',
    'INCORRECT_ADDRESS',
    'AWAITING_PAYMENT',
    'OTHER',
    'HIGH_RISK_OF_FRAUD',
];
const holdReasons_o2 = [
    'INCORRECT_ADDRESS',
    'AWAITING_PAYMENT',
    'INVENTORY_OUT_OF_STOCK',
    'AWAITING_RETURN_ITEMS',
    'INVENTORY_OUT_OF_STOCK',
    'AWAITING_RETURN_ITEMS',
    'UNKNOWN_DELIVERY_DATE',
    'ONLINE_STORE_POST_PURCHASE_CROSS_SELL',
    'HIGH_RISK_OF_FRAUD',
    'AWAITING_PAYMENT',
];
const holdReasons_o3 = [
    'HIGH_RISK_OF_FRAUD',
    'ONLINE_STORE_POST_PURCHASE_CROSS_SELL',
    'INCORRECT_ADDRESS',
    'INCORRECT_ADDRESS',
    'UNKNOWN_DELIVERY_DATE',
    'AWAITING_RETURN_ITEMS',
    'AWAITING_PAYMENT',
    'UNKNOWN_DELIVERY_DATE',
    'INCORRECT_ADDRESS',
    'ONLINE_STORE_POST_PURCHASE_CROSS_SELL',
];
const holdReasons_o4 = [
    'HIGH_RISK_OF_FRAUD',
    'AWAITING_PAYMENT',
    'AWAITING_RETURN_ITEMS',
    'AWAITING_PAYMENT',
    'HIGH_RISK_OF_FRAUD',
    'OTHER',
    'INVENTORY_OUT_OF_STOCK',
    'AWAITING_RETURN_ITEMS',
    'ONLINE_STORE_POST_PURCHASE_CROSS_SELL',
    'ONLINE_STORE_POST_PURCHASE_CROSS_SELL',
];

const holdDisplayReasonMap: Record<string, string> = {
    AWAITING_RETURN_ITEMS: 'Awaiting return items',
    HIGH_RISK_OF_FRAUD: 'High risk of fraud',
    INVENTORY_OUT_OF_STOCK: 'Inventory out of stock',
    INCORRECT_ADDRESS: 'Incorrect address',
    OTHER: 'Other',
    UNKNOWN_DELIVERY_DATE: 'Unknown delivery date',
    AWAITING_PAYMENT: 'Awaiting payment',
    ONLINE_STORE_POST_PURCHASE_CROSS_SELL: 'Post-purchase cross-sell',
};

const FO_LOCATION_NAMES = [
    'Main Distribution Center',
    'West Coast Fulfillment',
    'East Coast Warehouse',
    'Central Logistics Hub',
    'Southern Depot',
    'Northern Facility',
    'Airport Logistics',
    'Downtown Store',
    'Regional Center',
    'Industrial Park Warehouse',
];

function mkFulfillmentOrders(dests: any[], holdReasons: string[]) {
    return dests.map((dest, i) => ({
        __typename: 'FulfillmentOrder',
        id: `gid://shopify/FulfillmentOrder/fo-${h(`FO#${i}`) % 100000}`,
        destination: dest,
        assignedLocation: { name: pick(FO_LOCATION_NAMES, `FOAssLoc#${i}`) },
        status: 'IN_PROGRESS',
        fulfillmentHolds: holdReasons.map((reason) => ({
            reason,
            displayReason: holdDisplayReasonMap[reason] ?? reason,
            reasonNotes: `Hold notes: ${reason.toLowerCase().replace(/_/g, ' ')}`,
        })),
    }));
}

// Risk assessments (shop-019)
const riskAssessments_o0 = [
    {
        riskLevel: 'NONE',
        facts: [
            {
                description:
                    'Payment method declined by processor due to invalid card information.',
            },
            {
                description:
                    'Customer billing address in high-risk country not matching shipping location.',
            },
        ],
    },
    {
        riskLevel: 'PENDING',
        facts: [
            { description: 'Customer email address associated with known fraud ring.' },
            {
                description:
                    'Order contains suspicious combination of high-value and low-value items.',
            },
        ],
    },
];
const riskAssessments_o1 = [
    {
        riskLevel: 'NONE',
        facts: [
            {
                description:
                    'Customer phone number could not be verified through validation service.',
            },
            { description: 'Unusual spike in order quantity for bulk purchase.' },
        ],
    },
    {
        riskLevel: 'MEDIUM',
        facts: [
            { description: 'First purchase from customer with no previous order history.' },
            { description: 'Email domain associated with temporary email service provider.' },
        ],
    },
];
const riskAssessments_o2 = [
    {
        riskLevel: 'NONE',
        facts: [
            { description: 'Delivery address in rural area with limited fulfillment coverage.' },
            { description: 'Shipping address is known to have high chargeback rate.' },
        ],
    },
    {
        riskLevel: 'NONE',
        facts: [
            {
                description:
                    'Customer IP address detected in multiple high-risk transactions today.',
            },
            {
                description:
                    'Customer created account and made purchase within 5 minutes of signup.',
            },
        ],
    },
];
const riskAssessments_o3 = [
    {
        riskLevel: 'PENDING',
        facts: [
            {
                description:
                    'Order exceeds the typical purchase value threshold for this customer.',
            },
            { description: 'Multiple failed payment attempts using different credit cards.' },
        ],
    },
    {
        riskLevel: 'LOW',
        facts: [
            {
                description:
                    'Order flagged for potential payment fraud based on IP geolocation mismatch.',
            },
            { description: 'Velocity check failed - too many transactions in short timeframe.' },
        ],
    },
];
const riskAssessments_o4 = [
    {
        riskLevel: 'HIGH',
        facts: [
            { description: 'Unusual purchasing pattern detected for this customer account.' },
            { description: 'Shipping address differs significantly from billing address on file.' },
        ],
    },
    {
        riskLevel: 'NONE',
        facts: [
            { description: 'Customer account shows signs of being compromised or hacked.' },
            { description: 'Payment method flagged by bank as potentially compromised.' },
        ],
    },
];

// Disputes (shop-056, 10 total = 2 per order)
// IDs come from stableHash of compound key
const s = stableHash;
const disputes_o0 = [
    {
        id: `Order.disputes[0]#${s('Order.disputes[0]#' + s('Order#ord-0'))}`,
        initiatedAs: 'INQUIRY',
        status: 'NEEDS_RESPONSE',
    },
    {
        id: `Order.disputes[1]#${s('Order.disputes[1]#' + s('Order#ord-0'))}`,
        initiatedAs: 'CHARGEBACK',
        status: 'LOST',
    },
];
const disputes_o1 = [
    {
        id: `Order.disputes[0]#${s('Order.disputes[0]#' + s('Order#ord-1'))}`,
        initiatedAs: 'INQUIRY',
        status: 'ACCEPTED',
    },
    {
        id: `Order.disputes[1]#${s('Order.disputes[1]#' + s('Order#ord-1'))}`,
        initiatedAs: 'INQUIRY',
        status: 'ACCEPTED',
    },
];
const disputes_o2 = [
    {
        id: `Order.disputes[0]#${s('Order.disputes[0]#' + s('Order#ord-2'))}`,
        initiatedAs: 'CHARGEBACK',
        status: 'CHARGE_REFUNDED',
    },
    {
        id: `Order.disputes[1]#${s('Order.disputes[1]#' + s('Order#ord-2'))}`,
        initiatedAs: 'INQUIRY',
        status: 'WON',
    },
];
const disputes_o3 = [
    {
        id: `Order.disputes[0]#${s('Order.disputes[0]#' + s('Order#ord-3'))}`,
        initiatedAs: 'INQUIRY',
        status: 'ACCEPTED',
    },
    {
        id: `Order.disputes[1]#${s('Order.disputes[1]#' + s('Order#ord-3'))}`,
        initiatedAs: 'CHARGEBACK',
        status: 'LOST',
    },
];
const disputes_o4 = [
    {
        id: `Order.disputes[0]#${s('Order.disputes[0]#' + s('Order#ord-4'))}`,
        initiatedAs: 'CHARGEBACK',
        status: 'UNDER_REVIEW',
    },
    {
        id: `Order.disputes[1]#${s('Order.disputes[1]#' + s('Order#ord-4'))}`,
        initiatedAs: 'INQUIRY',
        status: 'WON',
    },
];

// TaxLines per order (shop-016: 5 orders each with 2 tax lines)
const mkTaxLine = (amount: string) => ({
    priceSet: moneyBag(amount, 'USD'),
    price: money(amount, 'USD'),
});
const taxLines_o0 = [mkTaxLine('105.50'), mkTaxLine('39.99')];
const taxLines_o1 = [mkTaxLine('9.99'), mkTaxLine('29.99')];
const taxLines_o2 = [mkTaxLine('235.00'), mkTaxLine('275.99')];
const taxLines_o3 = [mkTaxLine('299.00'), mkTaxLine('20.00')];
const taxLines_o4 = [mkTaxLine('38.99'), mkTaxLine('92.50')];

// AdditionalFees per order (shop-018)
const addFees_o0 = [
    { id: 'af-o0-1', name: 'Insurance Charge', price: moneyBag('44.50', 'AUD') },
    { id: 'af-o0-2', name: 'Expedited Shipping', price: moneyBag('22.99', 'FJD') },
];
const addFees_o1 = [
    { id: 'af-o1-1', name: 'Handling Fee', price: moneyBag('175.50', 'SSP') },
    { id: 'af-o1-2', name: 'Signature Required', price: moneyBag('165.00', 'OMR') },
];
const addFees_o2 = [
    { id: 'af-o2-1', name: 'Gift Message Card', price: moneyBag('34.50', 'ILS') },
    { id: 'af-o2-2', name: 'Assembly Fee', price: moneyBag('49.99', 'DJF') },
];
const addFees_o3 = [
    { id: 'af-o3-1', name: 'Rush Processing', price: moneyBag('32.50', 'ARS') },
    { id: 'af-o3-2', name: 'Eco-Friendly Packaging', price: moneyBag('86.99', 'PHP') },
];
const addFees_o4 = [
    { id: 'af-o4-1', name: 'Service Charge', price: moneyBag('214.00', 'NOK') },
    { id: 'af-o4-2', name: 'Gift Wrapping', price: moneyBag('12.00', 'SOS') },
];

// Discount applications (shop-013: 2 per order) — concrete types implementing DiscountApplication
const discApps_o0 = [
    {
        __typename: 'ManualDiscountApplication',
        allocationMethod: 'ONE',
        targetSelection: 'ENTITLED',
        targetType: 'LINE_ITEM',
    },
    {
        __typename: 'ManualDiscountApplication',
        allocationMethod: 'ACROSS',
        targetSelection: 'EXPLICIT',
        targetType: 'LINE_ITEM',
    },
];
const discApps_o1 = [
    {
        __typename: 'ManualDiscountApplication',
        allocationMethod: 'ONE',
        targetSelection: 'EXPLICIT',
        targetType: 'SHIPPING_LINE',
    },
    {
        __typename: 'ManualDiscountApplication',
        allocationMethod: 'ONE',
        targetSelection: 'ENTITLED',
        targetType: 'LINE_ITEM',
    },
];
const discApps_o2 = [
    {
        __typename: 'ManualDiscountApplication',
        allocationMethod: 'ONE',
        targetSelection: 'ENTITLED',
        targetType: 'LINE_ITEM',
    },
    {
        __typename: 'ManualDiscountApplication',
        allocationMethod: 'ONE',
        targetSelection: 'ENTITLED',
        targetType: 'SHIPPING_LINE',
    },
];
const discApps_o3 = [
    {
        __typename: 'ManualDiscountApplication',
        allocationMethod: 'ACROSS',
        targetSelection: 'EXPLICIT',
        targetType: 'LINE_ITEM',
    },
    {
        __typename: 'ManualDiscountApplication',
        allocationMethod: 'ACROSS',
        targetSelection: 'EXPLICIT',
        targetType: 'LINE_ITEM',
    },
];
const discApps_o4 = [
    {
        __typename: 'ManualDiscountApplication',
        allocationMethod: 'ONE',
        targetSelection: 'ENTITLED',
        targetType: 'SHIPPING_LINE',
    },
    {
        __typename: 'ManualDiscountApplication',
        allocationMethod: 'ONE',
        targetSelection: 'EXPLICIT',
        targetType: 'LINE_ITEM',
    },
];

// Returns for orders (shop-043: first 3 orders have returns)
const returns_o0 = [
    {
        __typename: 'Return',
        id: 'ret-o0-1',
        _seed: h('Return#ret-o0-1'),
        name: '#95949',
        status: 'CLOSED',
        returnLineItems: [],
        refunds: [],
    },
    {
        __typename: 'Return',
        id: 'ret-o0-2',
        _seed: h('Return#ret-o0-2'),
        name: '#46788',
        status: 'CANCELED',
        returnLineItems: [],
        refunds: [],
    },
];
const returns_o1 = [
    {
        __typename: 'Return',
        id: 'ret-o1-1',
        _seed: h('Return#ret-o1-1'),
        name: '#32437',
        status: 'CLOSED',
        returnLineItems: [],
        refunds: [],
    },
    {
        __typename: 'Return',
        id: 'ret-o1-2',
        _seed: h('Return#ret-o1-2'),
        name: '#77002',
        status: 'DECLINED',
        returnLineItems: [],
        refunds: [],
    },
];
const returns_o2 = [
    {
        __typename: 'Return',
        id: 'ret-o2-1',
        _seed: h('Return#ret-o2-1'),
        name: '#23441',
        status: 'OPEN',
        returnLineItems: [],
        refunds: [],
    },
    {
        __typename: 'Return',
        id: 'ret-o2-2',
        _seed: h('Return#ret-o2-2'),
        name: '#85263',
        status: 'OPEN',
        returnLineItems: [],
        refunds: [],
    },
];

// Fulfillments with tracking info (shop-009: 20 tracking rows across 5 orders × 4 each)
const trackingNums = [
    ['7890123456789012345', 'Amazon Logistics'],
    ['3333333333333333333', 'ABF Freight'],
    ['8901234567890123456', 'Forward Air'],
    ['5555555555555555', 'Central Transport'],
    ['9400111899223456789', 'Saia'],
    ['1001901234567890', 'JAG Freight'],
    ['6H061080021012', 'Estes'],
    ['1Z12X0Z41000000001', 'DHL Express'],
    ['6789012345678901234', 'YRC Freight'],
    ['794611123456', 'AAA Cooper'],
    ['9876543210987654321', 'Conway'],
    ['1234567890123456789', 'FedEx'],
    ['0123456789012345678', 'Old Dominion'],
    ['2222222222222222222', 'USPS'],
    ['4567890123456789012', 'XPO Logistics'],
    ['1111111111111111111', 'OnTrac'],
    ['3456789012345678901', 'Saia'],
    ['1Z999AA10123456784', 'LaserShip'],
    ['2345678901234567890', 'UPS'],
    ['5678901234567890123', 'ArcBest'],
];

function mkFulfillment(trackingPairs: string[][]) {
    return [
        {
            __typename: 'Fulfillment',
            id: `gid://shopify/Fulfillment/${h(`Fulfillment#${trackingPairs[0]?.[0] ?? 'x'}`) % 1000000}`,
            deliveredAt: '2025-04-15T14:30:00.000Z',
            trackingInfo: trackingPairs.map(([num, co]) => ({ number: num, company: co })),
        },
    ];
}

// Events for orders (shop-058: order with id gid://shopify/Order/1 has 2 events)
const orderEvents_ord1 = [
    {
        __typename: 'BasicEvent',
        id: 'gid://shopify/BasicEvent/1',
        message: 'Inventory level updated to 45 units',
    },
    {
        __typename: 'BasicEvent',
        id: 'gid://shopify/BasicEvent/2',
        message: 'New customer signup completed',
    },
];

function mkOrder(id: string, name: string, opts: Record<string, any> = {}) {
    const seed = h(`Order#${id}`);
    const numericSeed = (h(`Order.number#${seed}`) % 9000) + 1000;
    // Province/provinceCode: if a code is given, derive the matching full name; else pick a pair.
    const [defPc, defProvName] = province(`Order.prov#${id}`);
    const provinceCode = opts.provinceCode ?? defPc;
    const provinceName = opts.province ?? PROVINCE_NAME_BY_CODE[provinceCode] ?? defProvName;
    const shipAddr1 = opts.shippingAddress1 ?? streetAddress(`Order.shipAddr#${id}`);
    const shipCity = opts.shippingCity ?? pick(CITIES, `Order.shipCity#${id}`);
    const shipZip = zipCode(`Order.shipZip#${id}`);
    const billAddr1 = streetAddress(`Order.billAddr#${id}`);
    const billCity = pick(CITIES, `Order.billCity#${id}`);
    const billZip = zipCode(`Order.billZip#${id}`);
    const shipName =
        opts.shippingName ?? opts.customer?.displayName ?? fullName(`Order.shipName#${id}`);
    const billName = opts.billingName ?? shipName;
    const totalPriceAmt = opts.totalPrice ?? amount(`Order.totalPrice#${id}`);
    return {
        __typename: 'Order',
        id,
        _seed: seed,
        name,
        number: opts.number ?? numericSeed,
        createdAt:
            opts.createdAt ??
            `2025-0${(h(`Order.createdAt.month#${seed}`) % 5) + 1}-${String((h(`Order.createdAt.day#${seed}`) % 28) + 1).padStart(2, '0')}T${String(h(`Order.createdAt.hour#${seed}`) % 24).padStart(2, '0')}:00:00.000Z`,
        totalPrice: totalPriceAmt,
        currencyCode: opts.totalCurrency ?? 'USD',
        email: opts.email ?? emailAddr(`Order.email#${id}`),
        displayFinancialStatus: opts.displayFinancialStatus ?? 'PAID',
        displayFulfillmentStatus: opts.displayFulfillmentStatus ?? 'REQUEST_DECLINED',
        totalPriceSet: moneyBag(totalPriceAmt, opts.totalCurrency ?? 'USD'),
        totalOutstandingSet: moneyBag(
            opts.outstandingAmount ?? amount(`Order.outstanding#${id}`),
            'USD',
        ),
        currentTotalDutiesSet: moneyBag(
            opts.duties ?? amount(`Order.duties#${id}`),
            opts.dutiesCurrency ?? 'USD',
        ),
        discountCodes: opts.discountCodes ?? [],
        shippingAddress: {
            id: `gid://shopify/MailingAddress/${h(`Order.shippingAddr#${seed}`) % 100000}`,
            address1: shipAddr1,
            address2: null,
            city: shipCity,
            province: provinceName,
            provinceCode: provinceCode,
            country: 'United States',
            zip: shipZip,
            phone: null,
            name: shipName,
            formatted: formattedAddress(shipAddr1, shipCity, provinceCode, shipZip),
        },
        billingAddress: opts.billingAddress ?? {
            id: `gid://shopify/MailingAddress/billing-${h(`Order.billingAddr#${seed}`) % 100000}`,
            address1: billAddr1,
            address2: null,
            city: billCity,
            province: provinceName,
            provinceCode: provinceCode,
            country: 'United States',
            zip: billZip,
            phone: null,
            name: billName,
            formatted: formattedAddress(billAddr1, billCity, provinceCode, billZip),
        },
        taxLines: opts.taxLines ?? [],
        lineItems: opts.lineItems ?? [],
        refunds: opts.refunds ?? [],
        fulfillments: opts.fulfillments ?? [],
        fulfillmentOrders: opts.fulfillmentOrders ?? [],
        discountApplications: opts.discountApplications ?? [],
        additionalFees: opts.additionalFees ?? [],
        risk: opts.risk ?? { recommendation: 'NONE', assessments: [] },
        disputes: opts.disputes ?? [],
        customer: opts.customer ?? null,
        customerJourneySummary: opts.customerJourneySummary ?? null,
        returns: opts.returns ?? [],
        events: opts.events ?? [],
    };
}

export const ord0 = mkOrder('ord-0', 'Item 2920', {
    displayFulfillmentStatus: 'REQUEST_DECLINED',
    displayFinancialStatus: 'PAID',
    email: 'eve123@test.org',
    lineItems: [],
    refunds: refunds_o0,
    fulfillments: mkFulfillment(trackingNums.slice(0, 4)),
    fulfillmentOrders: mkFulfillmentOrders(foDest_o0, holdReasons_o0),
    discountCodes: ['SUMMER20', 'WELCOME15'],
    discountApplications: discApps_o0,
    additionalFees: addFees_o0,
    duties: '220.00',
    dutiesCurrency: 'ARS',
    risk: { recommendation: 'NONE', assessments: riskAssessments_o0 },
    disputes: disputes_o0,
    returns: returns_o0,
    taxLines: taxLines_o0,
    provinceCode: 'TX',
    customer: cust1,
});
export const ord1 = mkOrder('ord-1', 'Item 4129', {
    displayFulfillmentStatus: 'REQUEST_DECLINED',
    displayFinancialStatus: 'PAID',
    email: 'sarah420@shop.example.com',
    lineItems: li_o1,
    refunds: refunds_o1,
    fulfillments: mkFulfillment(trackingNums.slice(4, 8)),
    fulfillmentOrders: mkFulfillmentOrders(foDest_o1, holdReasons_o1),
    discountCodes: ['SPRING10', 'FREESHIP'],
    discountApplications: discApps_o1,
    additionalFees: addFees_o1,
    duties: '135.75',
    dutiesCurrency: 'TJS',
    risk: { recommendation: 'NONE', assessments: riskAssessments_o1 },
    disputes: disputes_o1,
    returns: returns_o1,
    taxLines: taxLines_o1,
    provinceCode: 'IL',
    customer: cust2,
});
export const ord2 = mkOrder('ord-2', 'Item 4665', {
    displayFulfillmentStatus: 'REQUEST_DECLINED',
    displayFinancialStatus: 'PAID',
    email: 'thomas.k.web@example.com',
    lineItems: li_o2,
    refunds: refunds_o2,
    fulfillments: mkFulfillment(trackingNums.slice(8, 12)),
    fulfillmentOrders: mkFulfillmentOrders(foDest_o2, holdReasons_o2),
    discountCodes: ['SAVE25', 'LOYALTY5'],
    discountApplications: discApps_o2,
    additionalFees: addFees_o2,
    duties: '44.99',
    dutiesCurrency: 'INR',
    risk: { recommendation: 'NONE', assessments: riskAssessments_o2 },
    disputes: disputes_o2,
    returns: returns_o2,
    taxLines: taxLines_o2,
    provinceCode: 'TN',
    customer: cust3,
});
export const ord3 = mkOrder('ord-3', 'Item 4308', {
    displayFulfillmentStatus: 'PENDING_FULFILLMENT',
    displayFinancialStatus: 'PAID',
    email: 'rachel.b.orders@example.com',
    lineItems: li_o3,
    refunds: refunds_o3,
    fulfillments: mkFulfillment(trackingNums.slice(12, 16)),
    fulfillmentOrders: mkFulfillmentOrders(foDest_o3, holdReasons_o3),
    discountCodes: ['FLASH30', 'NEWYEAR20'],
    discountApplications: discApps_o3,
    additionalFees: addFees_o3,
    duties: '59.99',
    dutiesCurrency: 'SRD',
    risk: { recommendation: 'INVESTIGATE', assessments: riskAssessments_o3 },
    disputes: disputes_o3,
    returns: [],
    taxLines: taxLines_o3,
    provinceCode: 'MD',
    customer: cust4,
});
export const ord4 = mkOrder('ord-4', 'Item 7956', {
    displayFulfillmentStatus: 'PARTIALLY_FULFILLED',
    displayFinancialStatus: 'PARTIALLY_PAID',
    email: 'nathan.p.shop@example.com',
    lineItems: [],
    refunds: refunds_o4,
    fulfillments: mkFulfillment(trackingNums.slice(16, 20)),
    fulfillmentOrders: mkFulfillmentOrders(foDest_o4, holdReasons_o4),
    discountCodes: ['CLEARANCE40', 'VIP10'],
    discountApplications: discApps_o4,
    additionalFees: addFees_o4,
    duties: '41.50',
    dutiesCurrency: 'NPR',
    risk: { recommendation: 'NONE', assessments: riskAssessments_o4 },
    disputes: disputes_o4,
    returns: [],
    taxLines: taxLines_o4,
    provinceCode: 'PA',
    customer: cust5,
    outstandingAmount: '15.99',
});

// Order with PARTIALLY_PAID financial status and outstanding balance (shop-008)
export const ord_partially_paid_1 = mkOrder('ord-pp-1', '#1086', {
    displayFinancialStatus: 'PARTIALLY_PAID',
    displayFulfillmentStatus: 'REQUEST_DECLINED',
    outstandingAmount: '67.00',
    refunds: [],
});

// Fix ord4 outstanding to match shop-008
(ord4 as any).totalOutstandingSet = moneyBag('15.99', 'USD');

// Literal lookup orders
export const ordObj1 = mkOrder('gid://shopify/Object/1', '#1091', {
    displayFinancialStatus: 'PAID',
    // shop-050 refund line items: 25 items with specific data
    refunds: [
        {
            __typename: 'Refund',
            id: 'refund-obj1',
            _seed: h('Refund#refund-obj1'),
            totalRefundedSet: moneyBag('75.99', 'USD'),
            createdAt: '2025-05-01T00:00:00.000Z',
            refundLineItems: [
                {
                    quantity: 654,
                    priceSet: moneyBag('235.50', 'USD'),
                    lineItem: mkLineItem('li-refund-1', 'Collection M', 1, 0),
                },
                {
                    quantity: 433,
                    priceSet: moneyBag('89.50', 'USD'),
                    lineItem: mkLineItem('li-refund-2', 'Series N', 1, 0),
                },
                {
                    quantity: 762,
                    priceSet: moneyBag('268.00', 'USD'),
                    lineItem: mkLineItem('li-refund-3', 'Model E', 1, 0),
                },
                {
                    quantity: 93,
                    priceSet: moneyBag('99.95', 'USD'),
                    lineItem: mkLineItem('li-refund-4', 'Stock H', 1, 0),
                },
                {
                    quantity: 786,
                    priceSet: moneyBag('28.00', 'USD'),
                    lineItem: mkLineItem('li-refund-5', 'Package J', 1, 0),
                },
                {
                    quantity: 84,
                    priceSet: moneyBag('225.50', 'USD'),
                    lineItem: mkLineItem('li-refund-6', 'Range O', 1, 0),
                },
                {
                    quantity: 640,
                    priceSet: moneyBag('37.25', 'USD'),
                    lineItem: mkLineItem('li-refund-7', 'Product A', 1, 0),
                },
                {
                    quantity: 971,
                    priceSet: moneyBag('189.99', 'USD'),
                    lineItem: mkLineItem('li-refund-8', 'Collection M', 1, 0),
                },
                {
                    quantity: 209,
                    priceSet: moneyBag('142.00', 'USD'),
                    lineItem: mkLineItem('li-refund-9', 'Model E', 1, 0),
                },
                {
                    quantity: 579,
                    priceSet: moneyBag('105.00', 'USD'),
                    lineItem: mkLineItem('li-refund-10', 'Unit G', 1, 0),
                },
                {
                    quantity: 929,
                    priceSet: moneyBag('79.00', 'USD'),
                    lineItem: mkLineItem('li-refund-11', 'Container I', 1, 0),
                },
                {
                    quantity: 864,
                    priceSet: moneyBag('53.75', 'USD'),
                    lineItem: mkLineItem('li-refund-12', 'Unit G', 1, 0),
                },
                {
                    quantity: 385,
                    priceSet: moneyBag('54.99', 'USD'),
                    lineItem: mkLineItem('li-refund-13', 'Variant C', 1, 0),
                },
                {
                    quantity: 228,
                    priceSet: moneyBag('52.00', 'USD'),
                    lineItem: mkLineItem('li-refund-14', 'Item B', 1, 0),
                },
                {
                    quantity: 825,
                    priceSet: moneyBag('199.95', 'USD'),
                    lineItem: mkLineItem('li-refund-15', 'Bundle K', 1, 0),
                },
                {
                    quantity: 697,
                    priceSet: moneyBag('7.25', 'USD'),
                    lineItem: mkLineItem('li-refund-16', 'Unit G', 1, 0),
                },
                {
                    quantity: 136,
                    priceSet: moneyBag('65.99', 'USD'),
                    lineItem: mkLineItem('li-refund-17', 'Package J', 1, 0),
                },
                {
                    quantity: 656,
                    priceSet: moneyBag('21.75', 'USD'),
                    lineItem: mkLineItem('li-refund-18', 'Unit G', 1, 0),
                },
                {
                    quantity: 695,
                    priceSet: moneyBag('49.95', 'USD'),
                    lineItem: mkLineItem('li-refund-19', 'Package J', 1, 0),
                },
                {
                    quantity: 891,
                    priceSet: moneyBag('26.50', 'USD'),
                    lineItem: mkLineItem('li-refund-20', 'Range O', 1, 0),
                },
                {
                    quantity: 518,
                    priceSet: moneyBag('119.95', 'USD'),
                    lineItem: mkLineItem('li-refund-21', 'SKU D', 1, 0),
                },
                {
                    quantity: 725,
                    priceSet: moneyBag('16.50', 'USD'),
                    lineItem: mkLineItem('li-refund-22', 'Item B', 1, 0),
                },
                {
                    quantity: 305,
                    priceSet: moneyBag('16.75', 'USD'),
                    lineItem: mkLineItem('li-refund-23', 'Series N', 1, 0),
                },
                {
                    quantity: 79,
                    priceSet: moneyBag('35.99', 'USD'),
                    lineItem: mkLineItem('li-refund-24', 'Stock H', 1, 0),
                },
                {
                    quantity: 781,
                    priceSet: moneyBag('24.99', 'USD'),
                    lineItem: mkLineItem('li-refund-25', 'Product A', 1, 0),
                },
            ],
        },
    ],
    customer: custObj1,
});

// Order 1042 (shop-003)
export const ord1042 = mkOrder('gid://shopify/Order/1042', 'Item 7250', {
    displayFinancialStatus: 'PAID',
    totalPrice: '34.99',
    totalCurrency: 'UGX',
    refunds: [],
});

// Order gid://shopify/Order/1 (shop-058)
export const ordOrder1 = mkOrder('gid://shopify/Order/1', '#1001', {
    events: orderEvents_ord1,
    refunds: [],
});

// Link custObj1 to its 2 orders (shop-041)
const custObj1Order1 = mkOrder('custobj1-ord-1', 'Item 5576', {
    displayFinancialStatus: 'PARTIALLY_PAID',
    totalPrice: '21.50',
    totalCurrency: 'SEK',
    refunds: [],
    customer: custObj1,
});
(custObj1Order1 as any).createdAt = '2024-09-30T00:00:00.000Z';

const custObj1Order2 = mkOrder('custobj1-ord-2', 'Item 3679', {
    displayFinancialStatus: 'PAID',
    totalPrice: '18.50',
    totalCurrency: 'RUB',
    refunds: [],
    customer: custObj1,
});
(custObj1Order2 as any).createdAt = '2024-07-02T00:00:00.000Z';

custObj1.orders = [custObj1Order1, custObj1Order2];

// Orders for cust2 (shop-049: has 4 orders after 2025-01-01)
const cust2Orders = [
    mkOrder('cust2-ord-1', '#1201', { customer: cust2 }),
    mkOrder('cust2-ord-2', '#1202', { customer: cust2 }),
    mkOrder('cust2-ord-3', '#1203', { customer: cust2 }),
    mkOrder('cust2-ord-4', '#1204', { customer: cust2 }),
];
cust2Orders.forEach((o) => {
    (o as any).createdAt = '2025-02-01T00:00:00.000Z';
});
cust2.orders = cust2Orders;

const cust3Orders = [
    mkOrder('cust3-ord-1', '#1301', { customer: cust3 }),
    mkOrder('cust3-ord-2', '#1302', { customer: cust3 }),
    mkOrder('cust3-ord-3', '#1303', { customer: cust3 }),
    mkOrder('cust3-ord-4', '#1304', { customer: cust3 }),
];
cust3Orders.forEach((o) => {
    (o as any).createdAt = '2025-02-01T00:00:00.000Z';
});
cust3.orders = cust3Orders;

const cust5Orders = [
    mkOrder('cust5-ord-1', '#1501', { customer: cust5 }),
    mkOrder('cust5-ord-2', '#1502', { customer: cust5 }),
    mkOrder('cust5-ord-3', '#1503', { customer: cust5 }),
    mkOrder('cust5-ord-4', '#1504', { customer: cust5 }),
];
cust5Orders.forEach((o) => {
    (o as any).createdAt = '2025-02-01T00:00:00.000Z';
});
cust5.orders = cust5Orders;

// cust1, cust4 have 0 qualifying orders (after 2025-01-01)
cust1.orders = [];
cust4.orders = [];

// Set cust1 (shop-051) order count
cust1.numberOfOrders = '12';
cust2.numberOfOrders = '3';
cust3.numberOfOrders = '5';
cust4.numberOfOrders = '15';
cust5.numberOfOrders = '23';

// Main orders list
export const allOrders = [ord0, ord1, ord2, ord3, ord4];
export const orderById = new Map<string, any>([
    ['gid://shopify/Object/1', ordObj1],
    ['gid://shopify/Order/1042', ord1042],
    ['gid://shopify/Order/1', ordOrder1],
    ...allOrders.map((o) => [o.id, o] as [string, any]),
    [ord_partially_paid_1.id, ord_partially_paid_1],
]);

// ---------------------------------------------------------------------------
// Draft Orders (5 for shop-012; 1 with OPEN status for shop-011)
// ---------------------------------------------------------------------------
function mkDraftOrder(
    id: string,
    name: string,
    status: string,
    customer: any,
    lineItems: any[],
    invoiceSentAt: string | null = null,
    createdAt = '2025-03-15T00:00:00.000Z',
) {
    return {
        __typename: 'DraftOrder',
        id,
        _seed: h(`DraftOrder#${id}`),
        name,
        status,
        invoiceSentAt,
        createdAt,
        invoiceUrl: `https://example-shop.myshopify.com/invoices/${h(`DraftOrder.invoiceUrl#${id}`) % 100000}`,
        tags: [] as string[],
        order: null as any, // fulfilled orders are null for draft
        lineItems,
        customer,
    };
}

const draftLI = (name: string) => ({
    __typename: 'DraftOrderLineItem',
    _seed: h(`DraftOrderLineItem#${name}`),
    name,
    custom: true,
    priceOverride: money('25.00', 'USD'),
});

export const draftOrd0 = mkDraftOrder(
    'draft-0',
    '#DO-2024-1003',
    'INVOICE_SENT',
    { displayName: 'James Rodriguez', email: 'cust-draft-0@example.com' },
    [draftLI('DraftLI-0-1'), draftLI('DraftLI-0-2')],
);
export const draftOrd1 = mkDraftOrder(
    'draft-1',
    '#DO-2024-1002',
    'INVOICE_SENT',
    { displayName: 'Sarah Johnson', email: 'cust-draft-1@example.com' },
    [draftLI('DraftLI-1-1'), draftLI('DraftLI-1-2')],
);
export const draftOrd2 = mkDraftOrder(
    'draft-2',
    '#DO-2024-1001',
    'OPEN',
    { displayName: 'Olivia Martinez', email: 'cust-draft-2@example.com' },
    [draftLI('DraftLI-2-1'), draftLI('DraftLI-2-2')],
    '2024-07-07T00:00:00.000Z',
);
export const draftOrd3 = mkDraftOrder(
    'draft-3',
    '#DO-2024-1005',
    'INVOICE_SENT',
    { displayName: 'Ethan Lee', email: 'cust-draft-3@example.com' },
    [draftLI('DraftLI-3-1'), draftLI('DraftLI-3-2')],
);
export const draftOrd4 = mkDraftOrder(
    'draft-4',
    '#DO-2024-1004',
    'INVOICE_SENT',
    { displayName: 'Charlotte Harris', email: 'cust-draft-4@example.com' },
    [draftLI('DraftLI-4-1'), draftLI('DraftLI-4-2')],
);
export const allDraftOrders = [draftOrd0, draftOrd1, draftOrd2, draftOrd3, draftOrd4];

// ---------------------------------------------------------------------------
// Abandoned Checkouts (5 for shop-042, 046, 052, 072)
// ---------------------------------------------------------------------------
function mkAbandonedCheckout(
    id: string,
    url: string,
    createdAt: string,
    customer: any,
    lineItems: any[],
    totalPriceAmount: string,
    totalCurrency: string,
) {
    const seed = h(`AbandonedCheckout#${id}`);
    return {
        __typename: 'AbandonedCheckout',
        id,
        _seed: seed,
        name: `#C${(h(`AbandonedCheckout.name#${id}`) % 9000) + 1000}`,
        abandonedCheckoutUrl: url,
        createdAt,
        totalPriceSet: moneyBag(totalPriceAmount, totalCurrency),
        customer,
        lineItems,
    };
}

const mkACLI = (title: string, qty: number, priceAmt: string, priceCurrency: string) => ({
    title,
    quantity: qty,
    originalTotalPriceSet: moneyBag(priceAmt, priceCurrency),
});

const acCust0 = {
    id: 'gid://shopify/Customer/101',
    displayName: 'Emma Williams',
    email: 'emma.w.shopping@example.com',
    defaultEmailAddress: {
        emailAddress: 'emma.w.shopping@example.com',
        marketingState: 'SUBSCRIBED',
        marketingUpdatedAt: '2024-06-01T00:00:00.000Z',
    },
};
const acCust1 = {
    id: 'gid://shopify/Customer/102',
    displayName: 'Evelyn Scott',
    email: 'olivia.m.buyer@example.com',
    defaultEmailAddress: {
        emailAddress: 'olivia.m.buyer@example.com',
        marketingState: 'SUBSCRIBED',
        marketingUpdatedAt: '2024-05-10T00:00:00.000Z',
    },
};
const acCust2 = {
    id: 'gid://shopify/Customer/103',
    displayName: 'Noah Davis',
    email: 'sophia.a.client@example.com',
    defaultEmailAddress: {
        emailAddress: 'sophia.a.client@example.com',
        marketingState: 'UNSUBSCRIBED',
        marketingUpdatedAt: '2024-03-22T00:00:00.000Z',
    },
};
const acCust3 = {
    id: 'gid://shopify/Customer/104',
    displayName: 'Liam Green',
    email: 'david.t.shopper@example.com',
    defaultEmailAddress: {
        emailAddress: 'david.t.shopper@example.com',
        marketingState: 'SUBSCRIBED',
        marketingUpdatedAt: '2024-07-18T00:00:00.000Z',
    },
};
const acCust4 = {
    id: 'gid://shopify/Customer/105',
    displayName: 'Sophia Anderson',
    email: 'james.r.customer@example.com',
    defaultEmailAddress: {
        emailAddress: 'james.r.customer@example.com',
        marketingState: 'UNSUBSCRIBED',
        marketingUpdatedAt: '2024-02-14T00:00:00.000Z',
    },
};

// shop-046: sorted descending by createdAt: 2025-05-24 > 2025-04-05 > 2025-02-22 > 2024-12-18 > 2024-07-14
// shop-042: same 5 checkouts in some order
export const ac3 = mkAbandonedCheckout(
    'ac-3',
    'https://example-shop.myshopify.com/cart/c/Z2NwLXVzLWVhc3QxOjAxJjBjMGYwYzI=?key=6521',
    '2025-05-24T00:00:00.000Z',
    acCust3,
    [
        mkACLI('Natural Soap Bar Set', 802, '278.25', 'ARS'),
        mkACLI('Solar Powered Charger', 771, '48.00', 'SSP'),
    ],
    '175.99',
    'TTD',
);
export const ac1 = mkAbandonedCheckout(
    'ac-1',
    'https://example-shop.myshopify.com/cart/c/Z2NwLXVzLWVhc3QxOjAxJjBjMGYwYzQ=?key=9209',
    '2025-04-05T00:00:00.000Z',
    acCust1,
    [
        mkACLI('Organic Cotton T-Shirt', 291, '17.00', 'AED'),
        mkACLI('Hiking Boot Waterproof', 160, '46.99', 'MXN'),
    ],
    '8.50',
    'SOS',
);
export const ac4 = mkAbandonedCheckout(
    'ac-4',
    'https://example-shop.myshopify.com/cart/c/Z2NwLXVzLWVhc3QxOjAxJjBjMGYwYzE=?key=5517',
    '2025-02-22T00:00:00.000Z',
    acCust4,
    [
        mkACLI('Premium Wireless Headphones', 962, '33.75', 'RWF'),
        mkACLI('Stainless Steel Water Bottle', 115, '74.99', 'PKR'),
    ],
    '98.00',
    'RON',
);
export const ac0 = mkAbandonedCheckout(
    'ac-0',
    'https://example-shop.myshopify.com/cart/c/Z2NwLXVzLWVhc3QxOjAxJjBjMGYwYzA=?key=1064',
    '2024-12-18T00:00:00.000Z',
    acCust0,
    [
        mkACLI('Yoga Mat Pro', 173, '129.00', 'KES'),
        mkACLI('Vintage Leather Journal', 0, '13.99', 'GMD'),
    ],
    '51.50',
    'HTG',
);
export const ac2 = mkAbandonedCheckout(
    'ac-2',
    'https://example-shop.myshopify.com/cart/c/Z2NwLXVzLWVhc3QxOjAxJjBjMGYwYzM=?key=7526',
    '2024-07-14T00:00:00.000Z',
    acCust2,
    [
        mkACLI('Ceramic Mug Collection', 959, '27.99', 'CVE'),
        mkACLI('Bamboo Cutting Board Set', 790, '195.50', 'BYN'),
    ],
    '18.50',
    'VUV',
);

// Default order: createdAt 2024-12-18, 2025-04-05, 2024-07-14, 2025-05-24, 2025-02-22
export const allAbandonedCheckouts = [ac0, ac1, ac2, ac3, ac4];
// Reverse sorted: ac3 (2025-05-24) > ac1 (2025-04-05) > ac4 (2025-02-22) > ac0 (2024-12-18) > ac2 (2024-07-14)
export const abandonedCheckoutsSortedDesc = [ac3, ac1, ac4, ac0, ac2];

// ---------------------------------------------------------------------------
// Gift Cards (shop-059: 2 with expired dates)
// ---------------------------------------------------------------------------
// GiftCard recipient helper
const mkGCRecipient = (email: string) => ({
    message: 'Happy Birthday! Enjoy this gift card.',
    preferredName: 'Friend',
    recipient: {
        id: 'gid://shopify/Customer/gc-r-1',
        displayName: 'Recipient Name',
        defaultEmailAddress: { emailAddress: email },
    },
    sendNotificationAt: null,
});

export const giftCard1 = {
    __typename: 'GiftCard',
    id: 'gc-1',
    _seed: h('GiftCard#gc-1'),
    expiresOn: '2024-10-23T00:00:00.000Z',
    createdAt: '2024-01-15T00:00:00.000Z',
    enabled: true,
    balance: money('50.00', 'USD'),
    initialValue: money('50.00', 'USD'),
    lastCharacters: '5678',
    maskedCode: '****5678',
    note: null,
    customer: {
        __typename: 'Customer',
        id: 'gid://shopify/Customer/gc-1',
        displayName: 'Mason White',
        email: 'mason.w@example.com',
    },
    order: {
        id: 'gid://shopify/Order/gc-ord-1',
        name: 'GCOrder #1001',
        email: 'mason.w@example.com',
        lineItems: { nodes: [{ title: 'Gift Card', isGiftCard: true }] },
    },
    recipientAttributes: mkGCRecipient('mason.w@example.com'),
};
export const giftCard2 = {
    __typename: 'GiftCard',
    id: 'gc-2',
    _seed: h('GiftCard#gc-2'),
    expiresOn: '2024-06-11T00:00:00.000Z',
    createdAt: '2023-12-20T00:00:00.000Z',
    enabled: false,
    balance: money('25.00', 'USD'),
    initialValue: money('100.00', 'USD'),
    lastCharacters: '1234',
    maskedCode: '****1234',
    note: 'Anniversary gift',
    customer: {
        __typename: 'Customer',
        id: 'gid://shopify/Customer/gc-2',
        displayName: 'Isabella Garcia',
        email: 'isabella.g@example.com',
    },
    order: {
        id: 'gid://shopify/Order/gc-ord-2',
        name: 'GCOrder #1002',
        email: 'isabella.g@example.com',
        lineItems: { nodes: [{ title: 'Gift Card', isGiftCard: true }] },
    },
    recipientAttributes: mkGCRecipient('isabella.g@example.com'),
};
export const allGiftCards = [giftCard1, giftCard2];

// ---------------------------------------------------------------------------
// Return (shop-057: gid://shopify/Return/1)
// ---------------------------------------------------------------------------
export const return1 = {
    __typename: 'Return',
    id: 'gid://shopify/Return/1',
    _seed: h('Return#gid://shopify/Return/1'),
    name: '#1042-R1',
    status: 'CANCELED',
    returnLineItems: [
        {
            __typename: 'ReturnLineItem',
            id: 'rli-1',
            _seed: h('ReturnLineItem#rli-1'),
            quantity: 89,
            returnReason: 'OTHER',
            customerNote: null,
        },
        {
            __typename: 'ReturnLineItem',
            id: 'rli-2',
            _seed: h('ReturnLineItem#rli-2'),
            quantity: 183,
            returnReason: 'UNWANTED',
            customerNote: null,
        },
    ],
    refunds: [
        {
            __typename: 'Refund',
            id: 'ret1-refund-1',
            _seed: h('Refund#ret1-refund-1'),
            totalRefundedSet: moneyBag('69.99', 'BYN'),
            createdAt: '2025-05-01T00:00:00.000Z',
            refundLineItems: [],
        },
        {
            __typename: 'Refund',
            id: 'ret1-refund-2',
            _seed: h('Refund#ret1-refund-2'),
            totalRefundedSet: moneyBag('81.25', 'TOP'),
            createdAt: '2025-05-02T00:00:00.000Z',
            refundLineItems: [],
        },
    ],
};

// ---------------------------------------------------------------------------
// Discount Nodes / Discounts
// ---------------------------------------------------------------------------
function mkDiscountNode(id: string, discountObj: any) {
    return {
        __typename: 'DiscountNode',
        id,
        _seed: h(`DiscountNode#${id}`),
        discount: discountObj,
    };
}
function mkCodeDiscountNode(id: string, codeDiscountObj: any) {
    return {
        __typename: 'DiscountCodeNode',
        id,
        _seed: h(`DiscountCodeNode#${id}`),
        codeDiscount: codeDiscountObj,
    };
}
const mkCodes = (codes: string[]) => codes.map((c) => ({ code: c }));
const mkSegments = (names: string[]) => names.map((n) => ({ name: n }));

// Helper for DiscountCustomerGets
const mkDiscountCustomerGets = (pct: number) => ({
    appliesOnOneTimePurchase: true,
    appliesOnSubscription: false,
    items: { __typename: 'DiscountProducts', products: [] },
    value: { __typename: 'DiscountPercentage', percentage: pct },
});

// Helper for DiscountContext (DiscountBuyerSelectionAll covers all customers)
const discountContextAll = { __typename: 'DiscountBuyerSelectionAll' };

// shop-061: 2 active code discounts (DiscountCodeBasic) with usageCount + codes
const dcBasic1 = {
    __typename: 'DiscountCodeBasic',
    title: 'Seasonal Sale Discount',
    asyncUsageCount: 410,
    status: 'ACTIVE',
    codes: mkCodes(['NEWYEAR20', 'HOLIDAY35']).map((c) => ({ ...c, asyncUsageCount: 45 })),
    minimumRequirement: null,
    customerSelection: null,
    appliesOncePerCustomer: false,
    endsAt: null,
    summary: 'Seasonal discount — 10% off for all customers using NEWYEAR20 or HOLIDAY35',
    shortSummary: '10% off entire order',
    customerGets: mkDiscountCustomerGets(10),
    context: discountContextAll,
};
const dcBasic2 = {
    __typename: 'DiscountCodeBasic',
    title: 'Flash Promo Offer',
    asyncUsageCount: 612,
    status: 'ACTIVE',
    codes: mkCodes(['PROMO10', 'FREESHIP']).map((c) => ({ ...c, asyncUsageCount: 80 })),
    minimumRequirement: null,
    customerSelection: null,
    appliesOncePerCustomer: true,
    endsAt: '2025-12-31T23:59:59.000Z',
    summary: 'Flash promo — 15% off for all customers using PROMO10 or FREESHIP',
    shortSummary: '15% off entire order',
    customerGets: mkDiscountCustomerGets(15),
    context: discountContextAll,
};

// shop-071: 2 DiscountCodeBasic with minimumSubtotal
const dcBasic3 = {
    __typename: 'DiscountCodeBasic',
    title: 'New Customer Welcome',
    asyncUsageCount: 100,
    status: 'ACTIVE',
    codes: [],
    minimumRequirement: {
        __typename: 'DiscountMinimumSubtotal',
        greaterThanOrEqualToSubtotal: money('63.99', 'GYD'),
    },
    customerSelection: null,
    appliesOncePerCustomer: true,
    endsAt: null,
    summary: 'Welcome discount — 20% off orders over $63.99',
    shortSummary: '20% off',
    customerGets: mkDiscountCustomerGets(20),
    context: discountContextAll,
};
const dcBasic4 = {
    __typename: 'DiscountCodeBasic',
    title: 'Clearance Discount Code',
    asyncUsageCount: 50,
    status: 'ACTIVE',
    codes: [],
    minimumRequirement: {
        __typename: 'DiscountMinimumSubtotal',
        greaterThanOrEqualToSubtotal: money('8.50', 'PAB'),
    },
    customerSelection: null,
    appliesOncePerCustomer: false,
    endsAt: '2025-06-30T23:59:59.000Z',
    summary: 'Clearance — 25% off on orders over $8.50',
    shortSummary: '25% off',
    customerGets: mkDiscountCustomerGets(25),
    context: discountContextAll,
};

// shop-062: 2 DiscountAutomaticBasic
const dcAutoBasic1 = {
    __typename: 'DiscountAutomaticBasic',
    title: 'Loyalty Reward',
    status: 'ACTIVE',
    startsAt: '2024-10-25T00:00:00.000Z',
    endsAt: null,
    minimumRequirement: {
        __typename: 'DiscountMinimumSubtotal',
        greaterThanOrEqualToSubtotal: money('77.50', 'KZT'),
    },
    customerGets: {
        appliesOnOneTimePurchase: true,
        appliesOnSubscription: false,
        items: { __typename: 'DiscountProducts', products: [] },
        value: { __typename: 'DiscountPercentage', percentage: 30 },
    },
};
const dcAutoBasic2 = {
    __typename: 'DiscountAutomaticBasic',
    title: 'New Customer Welcome',
    status: 'EXPIRED',
    startsAt: '2025-05-16T00:00:00.000Z',
    endsAt: '2025-09-30T23:59:59.000Z',
    minimumRequirement: {
        __typename: 'DiscountMinimumSubtotal',
        greaterThanOrEqualToSubtotal: money('84.99', 'SOS'),
    },
    customerGets: {
        appliesOnOneTimePurchase: true,
        appliesOnSubscription: true,
        items: { __typename: 'DiscountProducts', products: [] },
        value: { __typename: 'DiscountPercentage', percentage: 78.3 },
    },
};

// shop-066: 2 DiscountCodeBxgy — add asyncUsageCount, codes, endsAt, context
const bxgyProd1 = mkProduct('bxgy-prod-1', 'Smart Watch', 'bxgy-1', 'ACTIVE', {
    totalInventory: 1,
    variants: [],
    media: [],
    metafields: [],
    translations: [],
    resourcePublications: [],
});
const bxgyProd2 = mkProduct('bxgy-prod-2', 'Wireless Headphones', 'bxgy-2', 'ACTIVE', {
    totalInventory: 1,
    variants: [],
    media: [],
    metafields: [],
    translations: [],
    resourcePublications: [],
});
const bxgyProd3 = mkProduct('bxgy-prod-3', 'Yoga Mat', 'bxgy-3', 'ACTIVE', {
    totalInventory: 1,
    variants: [],
    media: [],
    metafields: [],
    translations: [],
    resourcePublications: [],
});
const bxgyProd4 = mkProduct('bxgy-prod-4', 'Wireless Headphones', 'bxgy-4', 'ACTIVE', {
    totalInventory: 1,
    variants: [],
    media: [],
    metafields: [],
    translations: [],
    resourcePublications: [],
});
const bxgyProd5 = mkProduct('bxgy-prod-5', 'Cotton T-Shirt', 'bxgy-5', 'ACTIVE', {
    totalInventory: 1,
    variants: [],
    media: [],
    metafields: [],
    translations: [],
    resourcePublications: [],
});
const bxgyProd6 = mkProduct('bxgy-prod-6', 'Yoga Mat', 'bxgy-6', 'ACTIVE', {
    totalInventory: 1,
    variants: [],
    media: [],
    metafields: [],
    translations: [],
    resourcePublications: [],
});
const bxgyProd7 = mkProduct('bxgy-prod-7', 'Cotton T-Shirt', 'bxgy-7', 'ACTIVE', {
    totalInventory: 1,
    variants: [],
    media: [],
    metafields: [],
    translations: [],
    resourcePublications: [],
});
const bxgyProd8 = mkProduct('bxgy-prod-8', 'Cotton T-Shirt', 'bxgy-8', 'ACTIVE', {
    totalInventory: 1,
    variants: [],
    media: [],
    metafields: [],
    translations: [],
    resourcePublications: [],
});

const dcBxgy1 = {
    __typename: 'DiscountCodeBxgy',
    title: 'Buy 2 Get 1 Free',
    status: 'EXPIRED',
    asyncUsageCount: 245,
    endsAt: '2024-12-31T23:59:59.000Z',
    appliesOncePerCustomer: false,
    summary: 'Buy 2 Get 1 Free — expired',
    codes: mkCodes(['BUY2GET1']).map((c) => ({ ...c, asyncUsageCount: 245 })),
    context: discountContextAll,
    customerBuys: { items: { __typename: 'DiscountProducts', products: [bxgyProd1, bxgyProd2] } },
    customerGets: {
        appliesOnOneTimePurchase: true,
        appliesOnSubscription: false,
        items: { __typename: 'DiscountProducts', products: [bxgyProd3, bxgyProd4] },
        value: { __typename: 'DiscountPercentage', percentage: 100 },
    },
};
const dcBxgy2 = {
    __typename: 'DiscountCodeBxgy',
    title: 'Bundle and Save Promotion',
    status: 'ACTIVE',
    asyncUsageCount: 88,
    endsAt: null,
    appliesOncePerCustomer: true,
    summary: 'Bundle and Save — 50% off bundle items',
    codes: mkCodes(['BUNDLE15']).map((c) => ({ ...c, asyncUsageCount: 88 })),
    context: discountContextAll,
    customerBuys: { items: { __typename: 'DiscountProducts', products: [bxgyProd5, bxgyProd6] } },
    customerGets: {
        appliesOnOneTimePurchase: true,
        appliesOnSubscription: true,
        items: { __typename: 'DiscountProducts', products: [bxgyProd7, bxgyProd8] },
        value: { __typename: 'DiscountPercentage', percentage: 50 },
    },
};

// shop-067: 2 DiscountCodeFreeShipping
const dcFreeShip1 = {
    __typename: 'DiscountCodeFreeShipping',
    title: 'Complimentary Shipping Offer',
    status: 'ACTIVE',
    asyncUsageCount: 381,
    endsAt: null,
    appliesOncePerCustomer: false,
    context: discountContextAll,
    shortSummary: 'Free shipping on orders $50+',
    summary: 'Free shipping — no minimum purchase required. Valid for all customers.',
    codes: mkCodes(['FREESHIP50']).map((c) => ({ ...c, asyncUsageCount: 381 })),
    minimumRequirement: {
        __typename: 'DiscountMinimumSubtotal',
        greaterThanOrEqualToSubtotal: money('50.00', 'USD'),
    },
    customerGets: {
        appliesOnOneTimePurchase: true,
        appliesOnSubscription: false,
        items: { __typename: 'DiscountProducts', products: [] },
        value: { __typename: 'DiscountPercentage', percentage: 100 },
    },
};
const dcFreeShip2 = {
    __typename: 'DiscountCodeFreeShipping',
    title: 'Free Shipping on Orders Over $50',
    status: 'EXPIRED',
    asyncUsageCount: 228,
    endsAt: '2024-09-30T23:59:59.000Z',
    appliesOncePerCustomer: true,
    context: discountContextAll,
    shortSummary: 'Free shipping — expired',
    summary: 'Free shipping on orders over $50 — promotion expired September 30, 2024.',
    codes: mkCodes(['FREESHIP']).map((c) => ({ ...c, asyncUsageCount: 228 })),
    minimumRequirement: {
        __typename: 'DiscountMinimumSubtotal',
        greaterThanOrEqualToSubtotal: money('50.00', 'USD'),
    },
    customerGets: {
        appliesOnOneTimePurchase: true,
        appliesOnSubscription: false,
        items: { __typename: 'DiscountProducts', products: [] },
        value: { __typename: 'DiscountPercentage', percentage: 100 },
    },
};

// shop-078: 2 DiscountAutomaticApp
const dcAutoApp1 = {
    __typename: 'DiscountAutomaticApp',
    title: 'Bulk Purchase Discount',
    status: 'SCHEDULED',
    startsAt: '2025-07-01T00:00:00.000Z',
    endsAt: null,
    discountId: 'gid://shopify/DiscountAutomaticApp/daa-1',
    appliesOnSubscription: false,
};
const dcAutoApp2 = {
    __typename: 'DiscountAutomaticApp',
    title: 'Volume Pricing Engine',
    status: 'ACTIVE',
    startsAt: '2024-01-01T00:00:00.000Z',
    endsAt: null,
    discountId: 'gid://shopify/DiscountAutomaticApp/daa-2',
    appliesOnSubscription: true,
};

// shop-075: SUMMER25 code discount
const dcSummer25 = {
    __typename: 'DiscountCodeBasic',
    title: 'SUMMER25 Discount',
    asyncUsageCount: 585,
    status: 'ACTIVE',
    codes: mkCodes(['SUMMER25']).map((c) => ({ ...c, asyncUsageCount: 585 })),
    minimumRequirement: null,
    customerSelection: null,
    appliesOncePerCustomer: false,
    endsAt: null,
    summary: 'Summer 2025 — 25% off entire order for all customers',
    shortSummary: '25% off',
    customerGets: mkDiscountCustomerGets(25),
    context: discountContextAll,
};
export const codeDiscSummer25 = mkCodeDiscountNode('summer25-node', dcSummer25);

// All discount nodes
export const discountNode_dcBasic1 = mkDiscountNode('dn-dcb1', dcBasic1);
export const discountNode_dcBasic2 = mkDiscountNode('dn-dcb2', dcBasic2);
export const discountNode_dcBasic3 = mkDiscountNode('dn-dcb3', dcBasic3);
export const discountNode_dcBasic4 = mkDiscountNode('dn-dcb4', dcBasic4);
export const discountNode_dcAutoBasic1 = mkDiscountNode('dn-dab1', dcAutoBasic1);
export const discountNode_dcAutoBasic2 = mkDiscountNode('dn-dab2', dcAutoBasic2);
export const discountNode_dcBxgy1 = mkDiscountNode('dn-bxgy1', dcBxgy1);
export const discountNode_dcBxgy2 = mkDiscountNode('dn-bxgy2', dcBxgy2);
export const discountNode_dcFreeShip1 = mkDiscountNode('dn-dfs1', dcFreeShip1);
export const discountNode_dcFreeShip2 = mkDiscountNode('dn-dfs2', dcFreeShip2);
export const discountNode_dcAutoApp1 = mkDiscountNode('dn-daa1', dcAutoApp1);
export const discountNode_dcAutoApp2 = mkDiscountNode('dn-daa2', dcAutoApp2);

export const allDiscountNodes = [
    discountNode_dcBasic1,
    discountNode_dcBasic2,
    discountNode_dcBasic3,
    discountNode_dcBasic4,
    discountNode_dcAutoBasic1,
    discountNode_dcAutoBasic2,
    discountNode_dcBxgy1,
    discountNode_dcBxgy2,
    discountNode_dcFreeShip1,
    discountNode_dcFreeShip2,
    discountNode_dcAutoApp1,
    discountNode_dcAutoApp2,
];

// DiscountAutomaticNode wrappers for automaticDiscountNodes (shop-078)
// These wrap each automatic discount with automaticDiscount field (DiscountAutomaticNode type)
function mkAutomaticDiscountNode(id: string, discountObj: any) {
    return {
        __typename: 'DiscountAutomaticNode',
        id,
        _seed: h(`DiscountAutomaticNode#${id}`),
        automaticDiscount: discountObj,
    };
}
export const automaticDiscountNode_dcAutoBasic1 = mkAutomaticDiscountNode('adn-dab1', dcAutoBasic1);
export const automaticDiscountNode_dcAutoBasic2 = mkAutomaticDiscountNode('adn-dab2', dcAutoBasic2);
export const automaticDiscountNode_dcAutoApp1 = mkAutomaticDiscountNode('adn-daa1', dcAutoApp1);
export const automaticDiscountNode_dcAutoApp2 = mkAutomaticDiscountNode('adn-daa2', dcAutoApp2);

// shop-073: 5 code discount nodes with segment-based customer selection
const mkCodeDiscNodeWithSegs = (id: string, title: string, segNames: string[]) => {
    const discount = {
        __typename: 'DiscountCodeBasic',
        title,
        asyncUsageCount: 0,
        status: 'ACTIVE',
        codes: [],
        minimumRequirement: null,
        customerSelection: {
            __typename: 'DiscountCustomerSegments',
            segments: mkSegments(segNames),
        },
        appliesOncePerCustomer: false,
        endsAt: null,
        summary: `${title} — segment-targeted discount`,
        shortSummary: '10% off',
        customerGets: mkDiscountCustomerGets(10),
        context: { __typename: 'DiscountCustomerSegments', segments: mkSegments(segNames) },
    };
    return mkCodeDiscountNode(id, discount);
};
const cdn1 = mkCodeDiscNodeWithSegs('cdn-1', 'Black Friday Special 2024', [
    'International customers',
    'Cart abandoners last 30 days',
]);
const cdn2 = mkCodeDiscNodeWithSegs('cdn-2', 'Birthday Special Offer', [
    'Inactive accounts 90+ days',
    'Bulk order customers',
]);
const cdn3 = mkCodeDiscNodeWithSegs('cdn-3', 'Customer Loyalty Discount', [
    'Mobile-only users',
    'Returns requesters',
]);
const cdn4 = mkCodeDiscNodeWithSegs('cdn-4', 'Summer Sale 15% Off', [
    'VIP loyalty members',
    'Seasonal shoppers Q4 2024',
]);
const cdn5 = mkCodeDiscNodeWithSegs('cdn-5', 'Holiday Gift Set Deal', [
    'High-value repeat customers',
    'First-time buyers',
]);

// shop-065: 5 code discount nodes with DiscountCodeApp
const mkCodeAppNode = (
    id: string,
    title: string,
    endsAt: string,
    codes: string[],
    status = 'ACTIVE',
) => {
    const discount = {
        __typename: 'DiscountCodeApp',
        title,
        endsAt,
        status,
        asyncUsageCount: 0,
        appliesOncePerCustomer: false,
        codes: mkCodes(codes).map((c) => ({ ...c, asyncUsageCount: 12 })),
        context: discountContextAll,
    };
    return mkCodeDiscountNode(id, discount);
};
const cdan1 = mkCodeAppNode('cdan-1', 'Flash Sale Weekend', '2024-09-22T00:00:00.000Z', [
    'SEASONAL40',
    'MEMBER30',
]);
const cdan2 = mkCodeAppNode('cdan-2', '20% Off Your Next Order', '2024-09-12T00:00:00.000Z', [
    'WELCOME25',
    'SAVE15NOW',
]);
const cdan3 = mkCodeAppNode('cdan-3', 'Referral Reward Discount', '2025-01-01T00:00:00.000Z', [
    'THANKSFOR5',
    'SUMMER2024',
]);
const cdan4 = mkCodeAppNode('cdan-4', 'Exclusive App Discount', '2025-01-25T00:00:00.000Z', [
    'EASTER25',
    'VIPCLUB',
]);
const cdan5 = mkCodeAppNode('cdan-5', 'VIP Member Savings', '2024-08-14T00:00:00.000Z', [
    'FLASH50',
    'LOYALTY10',
]);

export const allCodeDiscountNodes = [
    cdan1,
    cdan2,
    cdan3,
    cdan4,
    cdan5,
    cdn1,
    cdn2,
    cdn3,
    cdn4,
    cdn5,
    codeDiscSummer25,
];
export const automaticDiscountNodes = [
    automaticDiscountNode_dcAutoBasic1,
    automaticDiscountNode_dcAutoBasic2,
    automaticDiscountNode_dcAutoApp1,
    automaticDiscountNode_dcAutoApp2,
];

// ---------------------------------------------------------------------------
// Segments (shop-070, shop-076)
// ---------------------------------------------------------------------------
export const segment1 = {
    __typename: 'Segment',
    id: 'seg-1',
    _seed: h('Segment#seg-1'),
    name: 'Newsletter unsubscribed',
    query: 'customers where total_spent >= 500 AND created_at >= 2024-01-01',
    lastEditDate: '2025-05-23T00:00:00.000Z',
};
export const segment2 = {
    __typename: 'Segment',
    id: 'seg-2',
    _seed: h('Segment#seg-2'),
    name: 'Email subscribers engaged',
    query: 'orders where status = cancelled AND reason = customer_request',
    lastEditDate: '2024-09-14T00:00:00.000Z',
};
// Segment with id gid://shopify/Object/1 (shop-054, shop-064)
export const segmentObj1 = {
    __typename: 'Segment',
    id: 'gid://shopify/Object/1',
    _seed: h('Segment#gid://shopify/Object/1'),
    name: 'Customers with at least one order',
    query: 'customers_with_orders_count > 0',
    lastEditDate: '2025-05-01T00:00:00.000Z',
};
export const allSegments = [segment1, segment2, segmentObj1];

// ---------------------------------------------------------------------------
// Marketing Events & Activities (shop-063, shop-068, shop-077)
// ---------------------------------------------------------------------------
export const marketingEvent1 = {
    __typename: 'MarketingEvent',
    id: 'me-1',
    _seed: h('MarketingEvent#me-1'),
    utmCampaign: 'back_to_school',
    utmSource: 'email',
    utmMedium: 'newsletter',
    startedAt: '2025-02-19T00:00:00.000Z',
    endedAt: '2024-10-08T00:00:00.000Z',
    type: 'AFFILIATE',
    marketingChannelType: 'EMAIL',
    channelHandle: 'email',
    description: 'Back to school email campaign targeting returning customers',
    sourceAndMedium: 'email / newsletter',
};
export const marketingEvent2 = {
    __typename: 'MarketingEvent',
    id: 'me-2',
    _seed: h('MarketingEvent#me-2'),
    utmCampaign: 'back_to_school',
    utmSource: 'google',
    utmMedium: 'cpc',
    startedAt: '2025-02-26T00:00:00.000Z',
    endedAt: '2024-12-27T00:00:00.000Z',
    type: 'STOREFRONT_APP',
    marketingChannelType: 'SEARCH',
    channelHandle: 'google',
    description: 'Paid search campaign on Google targeting school supplies',
    sourceAndMedium: 'google / cpc',
};
export const allMarketingEvents = [marketingEvent1, marketingEvent2];

export const marketingActivity1 = {
    __typename: 'MarketingActivity',
    id: 'ma-1',
    _seed: h('MarketingActivity#ma-1'),
    marketingChannelType: 'SOCIAL',
    title: 'Copper Grilling Set',
};
export const marketingActivity2 = {
    __typename: 'MarketingActivity',
    id: 'ma-2',
    _seed: h('MarketingActivity#ma-2'),
    marketingChannelType: 'REFERRAL',
    title: 'Vintage Denim Jacket',
};
export const allMarketingActivities = [marketingActivity1, marketingActivity2];

// ---------------------------------------------------------------------------
// Companies (shop-084, shop-089, shop-096)
// ---------------------------------------------------------------------------
// Company contacts for shop-096 (4 contacts, 2 orders each)
const mkCompanyContact = (id: string, displayName: string, orderNames: string[]) => ({
    __typename: 'CompanyContact',
    id,
    _seed: h(`CompanyContact#${id}`),
    customer: { displayName },
    orders: orderNames.map((n) => mkOrder(`contact-order-${n}`, n, { refunds: [] })),
});

const cc1 = mkCompanyContact('cc-1', 'Ava Brown', ['Item 1408', 'Item 1749']);
const cc2 = mkCompanyContact('cc-2', 'Jackson King', ['Item 9986', 'Item 8682']);
const cc3 = mkCompanyContact('cc-3', 'Mia Martin', ['Item 1286', 'Item 7566']);
const cc4 = mkCompanyContact('cc-4', 'Lucas Taylor', ['Item 2701', 'Item 6557']);

// Company locations
const mkCatalog = (id: string, title: string, priceListName: string) => ({
    __typename: 'AppCatalog',
    id,
    _seed: h(`AppCatalog#${id}`),
    title,
    priceList: { name: priceListName },
});
const mkCompLoc = (id: string, name: string, ptTemplate: string, catalogs: any[]) => ({
    __typename: 'CompanyLocation',
    id,
    _seed: h(`CompanyLocation#${id}`),
    name,
    catalogs,
    buyerExperienceConfiguration: { paymentTermsTemplate: { name: ptTemplate, dueInDays: 30 } },
});

// Company 5068 (shop-084: locationCount 575)
const comp5068Loc1 = mkCompLoc('comp5068-loc-1', 'Processing Center - South', '2/10 Net 30', [
    mkCatalog('cat-5068-1', 'Loyalty Program Builder', 'Bulk Discount'),
    mkCatalog('cat-5068-2', 'SMS Marketing Automator', 'VIP Tier'),
]);
const comp5068Loc2 = mkCompLoc('comp5068-loc-2', 'Regional Hub - Midwest', 'Due on Receipt', [
    mkCatalog('cat-5068-3', 'Customer Analytics Dashboard', 'Retail Pricing'),
    mkCatalog('cat-5068-4', 'Bulk Order Processor', 'Retail Pricing'),
]);
export const company5068: any = {
    __typename: 'Company',
    id: 'comp-5068',
    _seed: h('Company#comp-5068'),
    name: 'Acme Wholesale Inc',
    locationsCount: { count: 575, precision: 'EXACT' },
    locations: [comp5068Loc1, comp5068Loc2],
    contacts: [cc1, cc2],
};

// Company 538 (shop-084: locationCount 831)
const comp538Loc1 = mkCompLoc('comp538-loc-1', 'Fulfillment Center - Northeast', 'Net 60', [
    mkCatalog('cat-538-1', 'Product Review System', 'VIP Tier'),
    mkCatalog('cat-538-2', 'Invoice Generator Plus', 'Wholesale Pricing'),
]);
const comp538Loc2 = mkCompLoc('comp538-loc-2', 'Warehouse - East Coast', '2/10 Net 30', [
    mkCatalog('cat-538-3', 'Shipping Rate Optimizer', 'Bulk Discount'),
    mkCatalog('cat-538-4', 'Abandoned Cart Recovery', 'Retail Pricing'),
]);
export const company538: any = {
    __typename: 'Company',
    id: 'comp-538',
    _seed: h('Company#comp-538'),
    name: 'Global Brands Ltd',
    locationsCount: { count: 831, precision: 'EXACT' },
    locations: [comp538Loc1, comp538Loc2],
    contacts: [cc3, cc4],
};

export const allCompanies = [company5068, company538];

// All company locations (for shop-088)
const locComp1 = mkCompLoc('comploc-1', 'Storage Facility - Southwest', 'Net 30', [
    mkCatalog('cat-cl1-1', 'Subscription Manager', 'Retail Pricing'),
    mkCatalog('cat-cl1-2', 'Live Chat Support', 'VIP Tier'),
]);
const locComp2 = mkCompLoc('comploc-2', 'Distribution Center - West', 'Net 60', [
    mkCatalog('cat-cl2-1', 'Page Builder Advanced', 'Wholesale Pricing'),
    mkCatalog('cat-cl2-2', 'Social Media Integration', 'Retail Pricing'),
]);
export const allCompanyLocations = [
    locComp1,
    locComp2,
    comp5068Loc1,
    comp5068Loc2,
    comp538Loc1,
    comp538Loc2,
];

// ---------------------------------------------------------------------------
// Delivery Profiles (shop-082, shop-083)
// ---------------------------------------------------------------------------
const mkDeliveryProfProduct = (id: string, title: string) => ({
    __typename: 'DeliveryProfileItem',
    id,
    product: mkProduct(id, title, id + '-handle', 'ACTIVE', {
        totalInventory: 1,
        variants: [],
        media: [],
        metafields: [],
        translations: [],
        resourcePublications: [],
    }),
});

let _deliveryRateDefCounter = 1;
function mkDeliveryZone(
    name: string,
    methodDefs: Array<{ name: string; amount: string; currency: string }>,
) {
    return {
        zone: { id: null, name, countries: [] },
        methodDefinitions: methodDefs.map((m) => ({
            __typename: 'DeliveryMethodDefinition',
            name: m.name,
            rateProvider: {
                __typename: 'DeliveryRateDefinition',
                id: `gid://shopify/DeliveryRateDefinition/${_deliveryRateDefCounter++}`,
                price: money(m.amount, m.currency),
            },
        })),
    };
}

export const deliveryProfile1: any = {
    __typename: 'DeliveryProfile',
    id: 'dp-1',
    _seed: h('DeliveryProfile#dp-1'),
    name: 'International Shipping Profile',
    profileItems: [
        mkDeliveryProfProduct('dp1-prod-1', 'Wireless Headphones'),
        mkDeliveryProfProduct('dp1-prod-2', 'Yoga Mat'),
    ],
    profileLocationGroups: [
        {
            locationGroup: null,
            locationGroupZones: [
                mkDeliveryZone('Europe Zone', [
                    { name: 'Regional Delivery', amount: '189.99', currency: 'SDG' },
                    { name: 'Priority Mail', amount: '15.00', currency: 'KGS' },
                ]),
                mkDeliveryZone('North America Zone', [
                    { name: 'Expedited Overnight', amount: '89.99', currency: 'EUR' },
                    { name: 'Two-Day Delivery', amount: '85.00', currency: 'AED' },
                ]),
            ],
        },
    ],
};

export const deliveryProfile2: any = {
    __typename: 'DeliveryProfile',
    id: 'dp-2',
    _seed: h('DeliveryProfile#dp-2'),
    name: 'Domestic Shipping Profile',
    profileItems: [
        mkDeliveryProfProduct('dp2-prod-1', 'Smart Watch'),
        mkDeliveryProfProduct('dp2-prod-2', 'Leather Wallet'),
    ],
    profileLocationGroups: [
        {
            locationGroup: null,
            locationGroupZones: [
                mkDeliveryZone('South America Zone', [
                    { name: 'Next-Day Air', amount: '35.99', currency: 'AFN' },
                    { name: 'International Standard', amount: '11.50', currency: 'ALL' },
                ]),
                mkDeliveryZone('Asia Pacific Zone', [
                    { name: 'Standard Ground Shipping', amount: '205.00', currency: 'KES' },
                    { name: 'Economy Ground', amount: '95.00', currency: 'JEP' },
                ]),
            ],
        },
    ],
};

export const allDeliveryProfiles = [deliveryProfile1, deliveryProfile2];
export const deliveryProfileById = new Map([
    ['gid://shopify/Object/1', deliveryProfile1],
    ...allDeliveryProfiles.map((dp) => [dp.id, dp] as [string, any]),
]);

// ---------------------------------------------------------------------------
// Carrier Services (shop-081)
// ---------------------------------------------------------------------------
export const carrierService1 = {
    __typename: 'DeliveryCarrierService',
    id: 'cs-1',
    _seed: h('DeliveryCarrierService#cs-1'),
    name: 'Express Logistics',
    callbackUrl: 'https://carrier-api.example.com/callback/3284',
};
export const carrierService2 = {
    __typename: 'DeliveryCarrierService',
    id: 'cs-2',
    _seed: h('DeliveryCarrierService#cs-2'),
    name: 'Worldwide Shipping Co',
    callbackUrl: 'https://carrier-api.example.com/callback/3596',
};
export const allCarrierServices = [carrierService1, carrierService2];

// ---------------------------------------------------------------------------
// Inventory Transfers (shop-086, shop-094)
// ---------------------------------------------------------------------------
export const invTransfer1 = {
    __typename: 'InventoryTransfer',
    id: 'it-1',
    _seed: h('InventoryTransfer#it-1'),
    name: '#TRANSFER-1001',
    status: 'IN_PROGRESS',
    totalQuantity: 625,
    dateCreated: '2024-07-06T00:00:00.000Z',
    origin: { name: 'Main Warehouse' },
    destination: { name: 'Regional Center' },
};
export const invTransfer2 = {
    __typename: 'InventoryTransfer',
    id: 'it-2',
    _seed: h('InventoryTransfer#it-2'),
    name: '#TRANSFER-1002',
    status: 'IN_PROGRESS',
    totalQuantity: 369,
    dateCreated: '2024-06-25T00:00:00.000Z',
    origin: { name: 'Industrial Park' },
    destination: { name: 'Main Warehouse' },
};
export const allInventoryTransfers = [invTransfer1, invTransfer2];

// ---------------------------------------------------------------------------
// Markets (shop-087)
// ---------------------------------------------------------------------------
export const market1 = {
    __typename: 'Market',
    id: 'mkt-1',
    _seed: h('Market#mkt-1'),
    name: 'US Market',
    priceInclusions: { inclusiveTaxPricingStrategy: 'INCLUDES_TAXES_IN_PRICE_BASED_ON_COUNTRY' },
};
export const market2 = {
    __typename: 'Market',
    id: 'mkt-2',
    _seed: h('Market#mkt-2'),
    name: 'EU Market',
    priceInclusions: { inclusiveTaxPricingStrategy: 'ADD_TAXES_AT_CHECKOUT' },
};
export const allMarkets = [market1, market2];

// ---------------------------------------------------------------------------
// Fulfillment Orders (standalone, for shop-090)
// ---------------------------------------------------------------------------
export const assignedFulfillmentOrders = [
    {
        __typename: 'FulfillmentOrder',
        id: 'afo-1',
        _seed: h('FulfillmentOrder#afo-1'),
        status: 'ON_HOLD',
        assignedLocation: { name: 'Central Fulfillment Center' },
        destination: null,
        fulfillmentHolds: [],
    },
    {
        __typename: 'FulfillmentOrder',
        id: 'afo-2',
        _seed: h('FulfillmentOrder#afo-2'),
        status: 'SCHEDULED',
        assignedLocation: { name: 'West Coast Hub' },
        destination: null,
        fulfillmentHolds: [],
    },
    {
        __typename: 'FulfillmentOrder',
        id: 'afo-3',
        _seed: h('FulfillmentOrder#afo-3'),
        status: 'IN_PROGRESS',
        assignedLocation: { name: 'Main Warehouse' },
        destination: null,
        fulfillmentHolds: [],
    },
    {
        __typename: 'FulfillmentOrder',
        id: 'afo-4',
        _seed: h('FulfillmentOrder#afo-4'),
        status: 'SCHEDULED',
        assignedLocation: { name: 'East Coast Distribution' },
        destination: null,
        fulfillmentHolds: [],
    },
    {
        __typename: 'FulfillmentOrder',
        id: 'afo-5',
        _seed: h('FulfillmentOrder#afo-5'),
        status: 'SCHEDULED',
        assignedLocation: { name: 'International Shipping Depot' },
        destination: null,
        fulfillmentHolds: [],
    },
];

// ---------------------------------------------------------------------------
// Shopify Payments Account (shop-092, shop-093)
// ---------------------------------------------------------------------------
export const shopifyPaymentsAccount = {
    __typename: 'ShopifyPaymentsAccount',
    id: 'spa-1',
    _seed: h('ShopifyPaymentsAccount#spa-1'),
    payouts: [
        {
            __typename: 'ShopifyPaymentsPayout',
            id: 'sp-payout-1',
            _seed: h('ShopifyPaymentsPayout#sp-payout-1'),
            issuedAt: '2025-03-17T00:00:00.000Z',
            status: 'CANCELED',
            net: money('45.00', 'VND'),
        },
        {
            __typename: 'ShopifyPaymentsPayout',
            id: 'sp-payout-2',
            _seed: h('ShopifyPaymentsPayout#sp-payout-2'),
            issuedAt: '2024-06-11T00:00:00.000Z',
            status: 'IN_TRANSIT',
            net: money('67.50', 'ETB'),
        },
    ],
    balanceTransactions: [
        {
            __typename: 'ShopifyPaymentsBalanceTransaction',
            id: 'sp-bt-1',
            _seed: h('ShopifyPaymentsBalanceTransaction#sp-bt-1'),
            transactionDate: '2024-06-18T00:00:00.000Z',
            type: 'RESERVED_FUNDS',
            amount: money('58.50', 'RON'),
        },
        {
            __typename: 'ShopifyPaymentsBalanceTransaction',
            id: 'sp-bt-2',
            _seed: h('ShopifyPaymentsBalanceTransaction#sp-bt-2'),
            transactionDate: '2025-05-21T00:00:00.000Z',
            type: 'SHIPPING_LABEL_ADJUSTMENT',
            amount: money('37.25', 'UGX'),
        },
    ],
};

// ---------------------------------------------------------------------------
// App Installations (shop-097, shop-099)
// ---------------------------------------------------------------------------
export const appInstallation1 = {
    __typename: 'AppInstallation',
    id: 'ai-1',
    _seed: h('AppInstallation#ai-1'),
    app: { title: 'Email Marketing Suite' },
    accessScopes: [
        { handle: 'write_products', description: 'Write access to Products' },
        { handle: 'write_settings', description: 'Write access to Settings' },
    ],
};
export const appInstallation2 = {
    __typename: 'AppInstallation',
    id: 'ai-2',
    _seed: h('AppInstallation#ai-2'),
    app: { title: 'Inventory Manager Pro' },
    accessScopes: [
        { handle: 'read_inventory', description: 'Read access to Inventory' },
        { handle: 'read_orders', description: 'Read access to Orders' },
    ],
};
export const allAppInstallations = [appInstallation1, appInstallation2];
export const currentAppInstallation = {
    __typename: 'AppInstallation',
    id: 'ai-current',
    _seed: h('AppInstallation#ai-current'),
    app: { title: 'Store Operations Console' },
    accessScopes: [
        { handle: 'manage_apps', description: 'Manage Apps access' },
        { handle: 'manage_customers', description: 'Manage Customers access' },
    ],
};

// ---------------------------------------------------------------------------
// Webhook Subscriptions (shop-098)
// ---------------------------------------------------------------------------
export const webhookSub1 = {
    __typename: 'WebhookSubscription',
    id: 'ws-1',
    _seed: h('WebhookSubscription#ws-1'),
    topic: 'COMPANY_CONTACT_ROLES_ASSIGN',
    uri: 'https://inventory-sync.example.com/shopify/webhooks/orders/created',
};
export const webhookSub2 = {
    __typename: 'WebhookSubscription',
    id: 'ws-2',
    _seed: h('WebhookSubscription#ws-2'),
    topic: 'FULFILLMENT_HOLDS_RELEASED',
    uri: 'https://analytics-hub.example.com/webhooks/fulfillments/completed',
};
export const allWebhookSubscriptions = [webhookSub1, webhookSub2];

// ---------------------------------------------------------------------------
// Shopify Functions (shop-100)
// ---------------------------------------------------------------------------
export const shopifyFunction1 = {
    __typename: 'ShopifyFunction',
    id: 'sf-1',
    _seed: h('ShopifyFunction#sf-1'),
    title: 'Tiered discount by order total',
    apiType: 'order_discount',
    apiVersion: '2025-01',
    appKey: 'my-discount-app',
    description: 'Applies tiered discounts based on the total order amount',
    inputQuery: null,
    useCreationUi: false,
    app: { __typename: 'App', id: 'app-fn-1', title: 'Discount Engine Pro' },
    appBridge: {
        detailsPath: '/admin/apps/my-app/detailspath/1218',
        createPath: '/admin/functions/create',
    },
};
export const shopifyFunction2 = {
    __typename: 'ShopifyFunction',
    id: 'sf-2',
    _seed: h('ShopifyFunction#sf-2'),
    title: 'Bundle product recommendation function',
    apiType: 'purchase_options',
    apiVersion: '2024-10',
    appKey: 'my-bundle-app',
    description: 'Recommends product bundles during checkout',
    inputQuery: null,
    useCreationUi: true,
    app: { __typename: 'App', id: 'app-fn-2', title: 'Bundle Builder App' },
    appBridge: {
        detailsPath: '/admin/apps/my-app/detailspath/8586',
        createPath: '/app/functions/new',
    },
};
export const allShopifyFunctions = [shopifyFunction1, shopifyFunction2];

// ---------------------------------------------------------------------------
// Payment Terms Templates (shop-085)
// ---------------------------------------------------------------------------
export const paymentTermsTemplate1 = {
    __typename: 'PaymentTermsTemplate',
    id: 'ptt-1',
    _seed: h('PaymentTermsTemplate#ptt-1'),
    name: '2/10 Net 30',
    dueInDays: 935,
};
export const paymentTermsTemplate2 = {
    __typename: 'PaymentTermsTemplate',
    id: 'ptt-2',
    _seed: h('PaymentTermsTemplate#ptt-2'),
    name: 'Net 30',
    dueInDays: 421,
};
export const allPaymentTermsTemplates = [paymentTermsTemplate1, paymentTermsTemplate2];

// ---------------------------------------------------------------------------
// Shop (shop-080)
// ---------------------------------------------------------------------------
export const shopObj = {
    __typename: 'Shop',
    id: 'shop-1',
    _seed: h('Shop#shop-1'),
    fulfillmentServices: [
        { serviceName: 'UPS Standard', type: 'MANUAL' },
        { serviceName: 'FedEx Ground', type: 'MANUAL' },
    ],
    search: {
        edges: [],
        nodes: [],
        pageInfo: {
            hasNextPage: false,
            hasPreviousPage: false,
            startCursor: null,
            endCursor: null,
        },
        resultsAfterCount: 0,
    },
};

// ---------------------------------------------------------------------------
// Publication objects (for Product.resourcePublications, resourcePublicationsV2, Product.publications)
// ---------------------------------------------------------------------------
export const pub1 = {
    __typename: 'Publication',
    id: 'pub-1',
    _seed: h('Publication#pub-1'),
    name: 'Online Store',
    title: 'Online Store',
    catalog: {
        __typename: 'AppCatalog',
        id: 'cat-pub-1',
        title: 'Online Store Catalog',
        priceList: null,
        publication: null,
        status: 'ACTIVE',
    },
    productPublicationsV3: {
        nodes: [],
        edges: [],
        pageInfo: {
            hasNextPage: false,
            hasPreviousPage: false,
            startCursor: null,
            endCursor: null,
        },
    },
};
export const pub2 = {
    __typename: 'Publication',
    id: 'pub-2',
    _seed: h('Publication#pub-2'),
    name: 'Mobile App',
    title: 'Mobile App',
    catalog: {
        __typename: 'AppCatalog',
        id: 'cat-pub-2',
        title: 'Mobile App Catalog',
        priceList: null,
        publication: null,
        status: 'ACTIVE',
    },
    productPublicationsV3: {
        nodes: [],
        edges: [],
        pageInfo: {
            hasNextPage: false,
            hasPreviousPage: false,
            startCursor: null,
            endCursor: null,
        },
    },
};
export const pub3 = {
    __typename: 'Publication',
    id: 'pub-3',
    _seed: h('Publication#pub-3'),
    name: 'Point of Sale',
    title: 'Point of Sale',
    catalog: {
        __typename: 'AppCatalog',
        id: 'cat-pub-3',
        title: 'POS Catalog',
        priceList: null,
        publication: null,
        status: 'ACTIVE',
    },
    productPublicationsV3: {
        nodes: [],
        edges: [],
        pageInfo: {
            hasNextPage: false,
            hasPreviousPage: false,
            startCursor: null,
            endCursor: null,
        },
    },
};
export const allPublications = [pub1, pub2, pub3];

// ---------------------------------------------------------------------------
// Channel objects (for QueryRoot.channels, Product.productPublications)
// ---------------------------------------------------------------------------
export const channel1 = {
    __typename: 'Channel',
    id: 'chan-1',
    _seed: h('Channel#chan-1'),
    name: 'Online Store',
    handle: 'online-store',
    productPublicationsV3: {
        nodes: [],
        edges: [],
        pageInfo: {
            hasNextPage: false,
            hasPreviousPage: false,
            startCursor: null,
            endCursor: null,
        },
    },
};
export const channel2 = {
    __typename: 'Channel',
    id: 'chan-2',
    _seed: h('Channel#chan-2'),
    name: 'Mobile App',
    handle: 'mobile-app',
    productPublicationsV3: {
        nodes: [],
        edges: [],
        pageInfo: {
            hasNextPage: false,
            hasPreviousPage: false,
            startCursor: null,
            endCursor: null,
        },
    },
};
export const allChannels = [channel1, channel2];

// ---------------------------------------------------------------------------
// DeliveryCustomization, PaymentCustomization, FulfillmentConstraintRule (shop-100)
// ---------------------------------------------------------------------------
export const deliveryCustomization1 = {
    __typename: 'DeliveryCustomization',
    id: 'dc-1',
    _seed: h('DeliveryCustomization#dc-1'),
    title: 'Express Delivery Customization',
    enabled: true,
    functionId: 'fn-delivery-1',
    shopifyFunction: {
        id: 'sf-1',
        title: 'Tiered discount by order total',
        apiType: 'order_discount',
        apiVersion: '2025-01',
        appKey: 'my-discount-app',
        description: null,
        inputQuery: null,
        useCreationUi: false,
        app: { __typename: 'App', id: 'app-fn-1', title: 'Discount Engine Pro' },
        appBridge: {
            detailsPath: '/admin/apps/my-app/detailspath/1218',
            createPath: '/admin/functions/create',
        },
    },
};
export const allDeliveryCustomizations = [deliveryCustomization1];

export const paymentCustomization1 = {
    __typename: 'PaymentCustomization',
    id: 'pc-1',
    _seed: h('PaymentCustomization#pc-1'),
    title: 'Hide Cash on Delivery',
    enabled: true,
    functionId: 'fn-payment-1',
    shopifyFunction: {
        id: 'sf-2',
        title: 'Bundle product recommendation function',
        apiType: 'purchase_options',
        apiVersion: '2024-10',
        appKey: 'my-bundle-app',
        description: null,
        inputQuery: null,
        useCreationUi: true,
        app: { __typename: 'App', id: 'app-fn-2', title: 'Bundle Builder App' },
        appBridge: {
            detailsPath: '/admin/apps/my-app/detailspath/8586',
            createPath: '/app/functions/new',
        },
    },
};
export const allPaymentCustomizations = [paymentCustomization1];

export const fulfillmentConstraintRule1 = {
    __typename: 'FulfillmentConstraintRule',
    id: 'fcr-1',
    _seed: h('FulfillmentConstraintRule#fcr-1'),
    function: {
        id: 'sf-1',
        title: 'Tiered discount by order total',
        apiType: 'order_discount',
        apiVersion: '2025-01',
        appKey: 'my-discount-app',
        description: 'Applies tiered discounts based on the total order amount',
        inputQuery: null,
        useCreationUi: false,
        app: { __typename: 'App', id: 'app-fn-1', title: 'Discount Engine Pro' },
        appBridge: {
            detailsPath: '/admin/apps/my-app/detailspath/1218',
            createPath: '/admin/functions/create',
        },
    },
};
export const allFulfillmentConstraintRules = [fulfillmentConstraintRule1];
