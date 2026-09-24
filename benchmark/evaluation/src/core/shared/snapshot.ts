/**
 * Parse a GraphQL SDL into a SchemaSnapshot with pre-embedded field vectors
 * and a closure that computes cosine similarity from any query vector to
 * every field.
 *
 * Snapshot build is parameterized on (field template × type template × model)
 * — the field template decides what string we embed per field; the type
 * template decides what string we embed per object/interface type; the model
 * decides what dimensions those vectors have. The hardcoded "T.f -> R — desc"
 * rendering moved into the default field template under
 * src/templates/coord-return-desc/; the type rendering lives under
 * src/type-templates/.
 *
 * Strategies receive the snapshot ready-made; they do not parse SDL themselves.
 */
import {
    buildSchema,
    isObjectType,
    isInterfaceType,
    isEnumType,
    isInputObjectType,
    getNamedType,
    isListType,
    isNonNullType,
    type GraphQLNamedType,
    type GraphQLObjectType,
    type GraphQLInterfaceType,
} from 'graphql';
import type {
    EmbeddingSetup,
    FieldDef,
    ModelDef,
    SchemaDef,
    SchemaSnapshot,
    TemplateContext,
    TemplateDef,
    TypeDef,
    TypeTemplateContext,
} from '../types.ts';
import { embedTexts } from './embeddings.ts';

/** Strip leading "_" / common GraphQL introspection types we never want to index. */
function isIntrospection(name: string): boolean {
    return name.startsWith('__');
}

function unwrapType(t: ReturnType<typeof getNamedType> | undefined): string {
    if (!t) throw new Error('getNamedType returned undefined');
    return t.name;
}

function isObjectOrInterface(t: GraphQLNamedType): t is GraphQLObjectType | GraphQLInterfaceType {
    return isObjectType(t) || isInterfaceType(t);
}

export async function buildSnapshot(
    setup: EmbeddingSetup & { schema: SchemaDef },
): Promise<SchemaSnapshot> {
    const { schema, template, typeTemplate, model } = setup;
    const gql = buildSchema(schema.sdl, { assumeValid: true });
    const typeMap = gql.getTypeMap();

    const fields: FieldDef[] = [];
    const descByCoord = new Map<string, string>();
    const types: string[] = [];
    const descByType = new Map<string, string>();
    const interfaceTypeNames = new Set<string>();

    for (const [typeName, gqlType] of Object.entries(typeMap)) {
        if (isIntrospection(typeName)) continue;
        if (!isObjectOrInterface(gqlType)) continue;
        types.push(typeName);
        if (isInterfaceType(gqlType)) interfaceTypeNames.add(typeName);
        const td = gqlType.description?.trim();
        if (td) descByType.set(typeName, td);
        const fieldMap = gqlType.getFields();
        for (const [fname, fdef] of Object.entries(fieldMap)) {
            const coord = `${typeName}.${fname}`;
            const isList =
                isListType(fdef.type) || (isNonNullType(fdef.type) && isListType(fdef.type.ofType));
            const isNonNull = isNonNullType(fdef.type);
            const returnTypeName = unwrapType(getNamedType(fdef.type));
            fields.push({
                coord,
                parent: typeName,
                field: fname,
                returnType: returnTypeName,
                isList,
                isNonNull,
            });
            const d = fdef.description?.trim();
            if (d) descByCoord.set(coord, d);
        }
    }

    // Build fieldsByType once; templates may reference it for context.
    const fieldsByType = new Map<string, FieldDef[]>();
    for (const f of fields) {
        if (!fieldsByType.has(f.parent)) fieldsByType.set(f.parent, []);
        fieldsByType.get(f.parent)!.push(f);
    }
    const fieldsByTypeReadonly: ReadonlyMap<string, ReadonlyArray<FieldDef>> = new Map(
        Array.from(fieldsByType.entries()).map(([k, v]) => [k, v as ReadonlyArray<FieldDef>]),
    );

    const ctx: TemplateContext = {
        schema,
        fieldsByType: fieldsByTypeReadonly,
        descriptionFor: (coord: string) => descByCoord.get(coord) ?? null,
    };

    // Render the embedding text per field via the configured field template.
    const textPerCoord = fields.map((f) => template.render(f, ctx));

    // Embed every field under (model, template). Cache makes re-runs free.
    const vectors = await embedTexts(model, template, textPerCoord);

    // Render + embed the TYPE space via the configured type template — an
    // axis independent of the field template. Build a TypeDef per enumerated
    // object/interface type, then a TypeTemplateContext exposing per-type
    // fields + descriptions. The cache is namespaced under
    // `type-templates/<id>` so the type axis never collides with field texts.
    const typeDefs: TypeDef[] = types.map((t) => ({
        name: t,
        kind: interfaceTypeNames.has(t) ? 'interface' : 'object',
        fieldNames: (fieldsByTypeReadonly.get(t) ?? []).map((f) => f.field),
    }));
    const typeCtx: TypeTemplateContext = {
        schema,
        fieldsByType: fieldsByTypeReadonly,
        descriptionForType: (t: string) => descByType.get(t) ?? null,
    };
    const typeTexts = typeDefs.map((td) => typeTemplate.render(td, typeCtx));
    const typeVectors = await embedTexts(
        model,
        { id: `type-templates/${typeTemplate.id}` },
        typeTexts,
    );

    const fieldByCoord = new Map<string, FieldDef>();
    const fieldEmbeddings = new Map<string, Float32Array>();
    for (let i = 0; i < fields.length; i++) {
        const f = fields[i]!;
        fieldByCoord.set(f.coord, f);
        fieldEmbeddings.set(f.coord, vectors[i]!);
    }

    // Derive root type NAMES from the schema's actual operation types, not the
    // conventional literals. Schemas may rename roots (e.g. Shopify's query root
    // is `QueryRoot`), so hardcoding 'Query' silently drops the root for them.
    const rootTypes = new Set<string>();
    for (const rt of [gql.getQueryType(), gql.getMutationType(), gql.getSubscriptionType()]) {
        if (rt) rootTypes.add(rt.name);
    }

    const typeEmbeddings = new Map<string, Float32Array>();
    for (let i = 0; i < types.length; i++) {
        typeEmbeddings.set(types[i]!, typeVectors[i]!);
    }

    // Pre-compute per-vector L2 norms once for fast cosine (fields + types).
    const normByCoord = new Map<string, number>();
    for (const [coord, v] of fieldEmbeddings) normByCoord.set(coord, l2(v));
    const normByType = new Map<string, number>();
    for (const [t, v] of typeEmbeddings) normByType.set(t, l2(v));

    function cosineToQuery(queryVec: Float32Array): Map<string, number> {
        const qn = l2(queryVec) || 1;
        const out = new Map<string, number>();
        for (const [coord, v] of fieldEmbeddings) {
            const denom = (normByCoord.get(coord) ?? 1) * qn;
            out.set(coord, denom === 0 ? 0 : dot(v, queryVec) / denom);
        }
        return out;
    }

    function cosineToQueryTypes(queryVec: Float32Array): Map<string, number> {
        const qn = l2(queryVec) || 1;
        const out = new Map<string, number>();
        for (const [t, v] of typeEmbeddings) {
            const denom = (normByType.get(t) ?? 1) * qn;
            out.set(t, denom === 0 ? 0 : dot(v, queryVec) / denom);
        }
        return out;
    }

    // ── Sub-element axis (arguments, input fields, enum values) ─────────────
    // Mirrors the field axis: enumerate every embeddable sub-element, dedup
    // identical embedding texts to save API calls, embed under the same model
    // but a distinct cache namespace, then expose vectors + a cosine closure.
    // Used by the cosine-aware buildSlice to keep only relevant optional args /
    // input fields / enum values.
    const elements = enumerateElements(typeMap);
    const uniqueTexts = Array.from(new Set(elements.map((e) => e.text)));
    const uniqueVectors = await embedTexts(model, elementCacheTemplate(model), uniqueTexts);
    const vecByText = new Map<string, Float32Array>();
    for (let i = 0; i < uniqueTexts.length; i++) vecByText.set(uniqueTexts[i]!, uniqueVectors[i]!);

    const elementEmbeddings = new Map<string, Float32Array>();
    for (const e of elements) elementEmbeddings.set(e.key, vecByText.get(e.text)!);

    const normByElement = new Map<string, number>();
    for (const [key, v] of elementEmbeddings) normByElement.set(key, l2(v));

    function cosineToQueryElements(queryVec: Float32Array): Map<string, number> {
        const qn = l2(queryVec) || 1;
        const out = new Map<string, number>();
        for (const [key, v] of elementEmbeddings) {
            const denom = (normByElement.get(key) ?? 1) * qn;
            out.set(key, denom === 0 ? 0 : dot(v, queryVec) / denom);
        }
        return out;
    }

    return {
        schema,
        fields,
        fieldByCoord,
        fieldsByType: fieldsByTypeReadonly,
        rootTypes,
        fieldEmbeddings,
        cosineToQuery,
        types,
        typeEmbeddings,
        cosineToQueryTypes,
        elementEmbeddings,
        cosineToQueryElements,
    };
}

interface ElementEntry {
    key: string;
    text: string;
}

/**
 * Enumerate every embeddable sub-element from the schema's type map:
 *   - ARGUMENT of every object/interface field
 *   - field of every input-object type
 *   - value of every enum type
 * The embedding text mirrors the field axis: an optional triple-quoted
 * description prefix (omitted when absent) followed by a coordinate string.
 */
function enumerateElements(
    typeMap: ReturnType<ReturnType<typeof buildSchema>['getTypeMap']>,
): ElementEntry[] {
    const out: ElementEntry[] = [];
    for (const [typeName, gqlType] of Object.entries(typeMap)) {
        if (isIntrospection(typeName)) continue;
        if (isObjectOrInterface(gqlType)) {
            for (const [fname, fdef] of Object.entries(gqlType.getFields())) {
                for (const arg of fdef.args) {
                    const argType = String(arg.type);
                    out.push({
                        key: `arg:${typeName}.${fname}(${arg.name})`,
                        text:
                            descPrefix(arg.description) +
                            `${typeName}.${fname}(${arg.name}: ${argType})`,
                    });
                }
            }
        } else if (isInputObjectType(gqlType)) {
            for (const [fname, fdef] of Object.entries(gqlType.getFields())) {
                out.push({
                    key: `in:${typeName}.${fname}`,
                    text:
                        descPrefix(fdef.description) + `${typeName}.${fname}: ${String(fdef.type)}`,
                });
            }
        } else if (isEnumType(gqlType)) {
            for (const v of gqlType.getValues()) {
                out.push({
                    key: `enum:${typeName}.${v.name}`,
                    text: descPrefix(v.description) + `${typeName}.${v.name}`,
                });
            }
        }
    }
    return out;
}

/** `"""<desc>"""` when a non-empty description exists, else empty string. */
function descPrefix(desc: string | null | undefined): string {
    const d = desc?.trim();
    return d ? `"""${d}"""` : '';
}

/**
 * Synthetic template handle that only carries the cache namespace id for the
 * sub-element axis. `embedTexts` keys the disk cache on (model.id, template.id),
 * so a distinct id keeps element vectors from colliding with field vectors.
 * The model is the SAME (openai-3-small) so cosine to the query is meaningful.
 */
function elementCacheTemplate(model: ModelDef): TemplateDef {
    void model;
    return {
        id: 'sub-elements/coord-desc',
        name: 'sub-element coord+desc',
        description: 'Embedding axis for arguments, input fields, and enum values.',
        applies: new Set(['field']),
        render: (f) => f.coord,
    };
}

function dot(a: Float32Array, b: Float32Array): number {
    if (a.length !== b.length) throw new Error(`dot: length mismatch ${a.length} vs ${b.length}`);
    let s = 0;
    for (let i = 0; i < a.length; i++) s += a[i]! * b[i]!;
    return s;
}

function l2(v: Float32Array): number {
    let s = 0;
    for (let i = 0; i < v.length; i++) s += v[i]! * v[i]!;
    return Math.sqrt(s);
}
