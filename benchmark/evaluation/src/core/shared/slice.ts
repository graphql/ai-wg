/**
 * Turn a set of selected field coordinates into a valid sliced SDL string.
 *
 * "Valid" here = readable + parseable; not minimum-typed. We keep the parent
 * type declaration of every selected coord, plus any return types reachable
 * from those parents within the selection. Scalar/enum types declared in the
 * source SDL are emitted unchanged.
 *
 * COSINE-AWARE RENDERING (opt-in via `opts.relevance`): optional arguments,
 * optional input-object fields, and irrelevant enum values are pruned by their
 * cosine relevance to the query, while required ones are always kept so the
 * slice stays a usable schema. Pruning changes only what is RENDERED — the set
 * of selected coords is untouched, so must-recall is unchanged by construction.
 *
 * This is INFRASTRUCTURE (called by the runner), not strategy code.
 */
import {
    buildSchema,
    print,
    type GraphQLNamedType,
    type GraphQLObjectType,
    type GraphQLInterfaceType,
    type GraphQLArgument,
    type GraphQLInputField,
    isObjectType,
    isInterfaceType,
    isEnumType,
    isScalarType,
    isUnionType,
    isInputObjectType,
    isInputType,
    isNonNullType,
    getNamedType,
} from 'graphql';

/**
 * Default cosine floor applied to arguments / input fields / enum values when
 * relevance-aware rendering is on and no explicit floor is given. A single
 * named constant so a threshold sweep is a one-line edit.
 */
export const DEFAULT_SLICE_FLOOR = 0.25;

/** Connection pagination args — kept unconditionally (with required args they
 *  cover 100% of operation-used arg coords). All other args are relevance-gated. */
const PAGINATION_ARGS = new Set(['first', 'after', 'last', 'before']);

export interface BuildSliceOptions {
    /** Cosine relevance of a sub-element key to the query; -1 (or any value
     * below the floor) drops it. Keys: `arg:T.f(a)`, `in:T.f`, `enum:T.V`. */
    relevance?: (key: string) => number;
    argFloor?: number;
    inputFloor?: number;
    enumFloor?: number;
    /**
     * "Explicit members" mode. When provided, takes precedence over the
     * relevance/floor path: an optional argument is rendered iff its key
     * `arg:T.f(a)` is in the set, an optional input-object field iff `in:T.f`
     * is in the set, and an enum value iff `enum:T.V` is in the set. Required
     * args/input-fields are always kept. The reachability cascade still applies
     * (types referenced only by dropped members are not emitted).
     */
    keptMembers?: ReadonlySet<string>;
    /** Omit deprecated fields and other deprecated members from the rendered slice. */
    stripDeprecated?: boolean;
}

export function buildSlice(
    sdl: string,
    selectedCoords: ReadonlyArray<string>,
    opts?: BuildSliceOptions,
): string {
    const schema = buildSchema(sdl, { assumeValid: true });
    const typeMap = schema.getTypeMap();

    const keptMembers = opts?.keptMembers;
    // In explicit-members mode the relevance/floor path is bypassed entirely;
    // we drive every survival decision off `keptMembers`. We still flip on the
    // same "compaction is active" machinery (`relevance` truthy gates the
    // filtered render/cascade) by handing emit a membership-based relevance
    // proxy so the existing arg/input filters and reachability walk reuse it.
    const relevance = keptMembers
        ? (key: string) => (keptMembers.has(key) ? 1 : 0)
        : opts?.relevance;
    // With the membership proxy a floor of 1 means "must be explicitly kept";
    // required members are handled separately by isRequired() and survive
    // regardless. Enum values use the same gate.
    const argFloor = keptMembers ? 1 : (opts?.argFloor ?? DEFAULT_SLICE_FLOOR);
    const inputFloor = keptMembers ? 1 : (opts?.inputFloor ?? DEFAULT_SLICE_FLOOR);
    const enumFloor = keptMembers ? 1 : (opts?.enumFloor ?? DEFAULT_SLICE_FLOOR);
    const stripDeprecated = opts?.stripDeprecated ?? false;

    const selectedByType = new Map<string, Set<string>>();
    for (const coord of selectedCoords) {
        const dot = coord.indexOf('.');
        if (dot < 0) continue;
        const parent = coord.slice(0, dot);
        const field = coord.slice(dot + 1);
        if (!selectedByType.has(parent)) selectedByType.set(parent, new Set());
        selectedByType.get(parent)!.add(field);
    }

    // ── Survival decisions (only meaningful when relevance is provided) ──────
    // For each rendered object/interface field, which arg names survive; for
    // each input type, which input-field names survive. When relevance is
    // undefined every arg/field survives (full back-compat render).
    const keptArgsByField = new Map<string, Set<string>>(); // "Type.field" → arg names
    const keptInputFields = new Map<string, Set<string>>(); // inputTypeName → field names

    // Enum-value propagation: a query usually names an enum VALUE ("open" →
    // IssueState.OPEN), not the arg/field. So an enum-typed member inherits the
    // MAX relevance over its enum's values — the signal lives one level deeper.
    function enumValueMaxRel(named: GraphQLNamedType): number {
        if (!relevance || !isEnumType(named)) return -Infinity;
        let m = -Infinity;
        for (const v of named.getValues()) {
            if (stripDeprecated && isDeprecated(v)) continue;
            const r = relevance(`enum:${named.name}.${v.name}`);
            if (r > m) m = r;
        }
        return m;
    }

    function fieldArgSurvives(parent: string, field: string, arg: GraphQLArgument): boolean {
        if (stripDeprecated && isDeprecated(arg)) return false;
        if (!relevance) return true;
        // Required args are mandatory to call the field; always keep.
        if (isRequired(arg)) return true;
        // Pagination args (`first/after/last/before`) drive every connection and
        // — with required args — cover 100% of operation-used arg coords, so keep
        // them unconditionally. Every OTHER arg (incl. optional scalar filters)
        // is relevance-gated: kept only when the query is actually about it.
        if (PAGINATION_ARGS.has(arg.name)) return true;
        const named = getNamedType(arg.type);
        let rel = relevance(`arg:${parent}.${field}(${arg.name})`);
        if (isEnumType(named)) rel = Math.max(rel, enumValueMaxRel(named));
        return rel >= argFloor;
    }

    function inputFieldSurvives(inputType: string, f: GraphQLInputField): boolean {
        if (stripDeprecated && isDeprecated(f)) return false;
        if (!relevance) return true;
        if (isRequired(f)) return true;
        const named = getNamedType(f.type);
        let rel = relevance(`in:${inputType}.${f.name}`);
        if (isEnumType(named)) rel = Math.max(rel, enumValueMaxRel(named));
        return rel >= inputFloor;
    }

    // Precompute surviving args for every selected output field.
    for (const [parent, fields] of selectedByType) {
        const gqlType = typeMap[parent];
        if (!gqlType || (!isObjectType(gqlType) && !isInterfaceType(gqlType))) continue;
        const fmap = gqlType.getFields();
        for (const fname of fields) {
            const fdef = fmap[fname];
            if (!fdef) continue;
            if (stripDeprecated && isDeprecated(fdef)) continue;
            const kept = new Set<string>();
            for (const a of fdef.args) {
                if (fieldArgSurvives(parent, fname, a)) kept.add(a.name);
            }
            keptArgsByField.set(`${parent}.${fname}`, kept);
        }
    }

    // ── Reachability closure ────────────────────────────────────────────────
    // Follow return types of selected output fields plus the types of SURVIVING
    // args / input fields only. Dropping optional args therefore also drops the
    // input types / enums they alone referenced — the big type-count + token
    // savings. Input-field survival is decided lazily as we reach each input
    // type during the walk.
    const reachableTypes = new Set<string>();
    const queue: string[] = [];
    for (const parent of selectedByType.keys()) {
        reachableTypes.add(parent);
        queue.push(parent);
    }
    function enqueue(name: string): void {
        if (!reachableTypes.has(name)) {
            reachableTypes.add(name);
            queue.push(name);
        }
    }
    while (queue.length > 0) {
        const t = queue.shift()!;
        const gqlType = typeMap[t];
        if (!gqlType) continue;
        if (isObjectType(gqlType) || isInterfaceType(gqlType)) {
            const selectedFields = selectedByType.get(t);
            const fmap = gqlType.getFields();
            for (const [fname, fdef] of Object.entries(fmap)) {
                // Only follow types of *selected* fields. A reachable-but-unselected
                // type is emitted as a bare stub (no fields), so it references
                // nothing — following its fields would pull in phantom types and
                // break render monotonicity (removing a coord could ADD types).
                if (!selectedFields || !selectedFields.has(fname)) continue;
                if (stripDeprecated && isDeprecated(fdef)) continue;
                enqueue(getNamedType(fdef.type).name);
                const kept = keptArgsByField.get(`${t}.${fname}`);
                for (const a of fdef.args) {
                    if ((relevance || stripDeprecated) && kept && !kept.has(a.name)) continue;
                    enqueue(getNamedType(a.type).name);
                }
            }
        } else if (isInputObjectType(gqlType)) {
            // Decide which input fields survive, then follow only their types.
            const kept = new Set<string>();
            for (const [fname, fdef] of Object.entries(gqlType.getFields())) {
                if (inputFieldSurvives(t, fdef)) {
                    kept.add(fname);
                    enqueue(getNamedType(fdef.type).name);
                }
            }
            keptInputFields.set(t, kept);
        }
    }

    const out: string[] = [];
    for (const [name, t] of Object.entries(typeMap)) {
        if (name.startsWith('__')) continue;
        if (!reachableTypes.has(name)) continue;
        const printed = emitType(t, selectedByType, {
            relevance,
            enumFloor,
            keptArgsByField,
            keptInputFields,
            explicitMembers: keptMembers !== undefined,
            stripDeprecated,
        });
        if (printed) out.push(printed);
    }
    return out.join('\n\n') + '\n';
}

interface EmitContext {
    relevance: ((key: string) => number) | undefined;
    enumFloor: number;
    keptArgsByField: ReadonlyMap<string, ReadonlySet<string>>;
    keptInputFields: ReadonlyMap<string, ReadonlySet<string>>;
    /** Explicit-members mode: an enum with zero kept values is emitted as a
     * bare `enum X` stub instead of falling back to its top-relevance value. */
    explicitMembers: boolean;
    stripDeprecated: boolean;
}

/** A field/input-field is "required" iff its type is NonNull and it has no
 * default value — such a field MUST stay for the schema to be usable. */
function isRequired(el: { type: import('graphql').GraphQLType; defaultValue?: unknown }): boolean {
    return isNonNullType(el.type) && el.defaultValue === undefined;
}

function isDeprecated(el: { deprecationReason?: string | null | undefined }): boolean {
    return el.deprecationReason != null;
}

function emitType(
    t: GraphQLNamedType,
    selectedByType: ReadonlyMap<string, ReadonlySet<string>>,
    ctx: EmitContext,
): string | null {
    if (isObjectType(t) || isInterfaceType(t)) {
        return emitObjectLike(t, selectedByType, ctx);
    }
    if (isEnumType(t)) {
        return emitEnum(t, ctx);
    }
    if (isUnionType(t)) {
        return `union ${t.name} = ${t
            .getTypes()
            .map((u) => u.name)
            .join(' | ')}`;
    }
    if (isInputObjectType(t)) {
        return emitInput(t, ctx);
    }
    if (isScalarType(t)) {
        // Skip built-in scalars; emit custom ones as bare declarations.
        const builtins = new Set(['String', 'Int', 'Float', 'Boolean', 'ID']);
        return builtins.has(t.name) ? null : `scalar ${t.name}`;
    }
    return null;
}

function emitObjectLike(
    t: GraphQLObjectType | GraphQLInterfaceType,
    selectedByType: ReadonlyMap<string, ReadonlySet<string>>,
    ctx: EmitContext,
): string | null {
    const selected = selectedByType.get(t.name);
    if (!selected || selected.size === 0) {
        // Type is reachable for typing purposes but no fields selected. Emit a stub
        // so referencing fields still resolve.
        const kw = isInterfaceType(t) ? 'interface' : 'type';
        return `${kw} ${t.name}`;
    }
    const ifaces =
        isObjectType(t) && t.getInterfaces().length > 0
            ? ` implements ${t
                  .getInterfaces()
                  .map((i) => i.name)
                  .join(' & ')}`
            : '';
    const kw = isInterfaceType(t) ? 'interface' : 'type';
    const fmap = t.getFields();
    const fieldLines: string[] = [];
    for (const fname of selected) {
        const fdef = fmap[fname];
        if (!fdef) continue;
        if (ctx.stripDeprecated && isDeprecated(fdef)) continue;
        const kept = ctx.keptArgsByField.get(`${t.name}.${fname}`);
        const renderedArgs = fdef.args
            .filter((a) => !ctx.stripDeprecated || !isDeprecated(a))
            .filter((a) => !ctx.relevance || !kept || kept.has(a.name))
            .map((a) => `${a.name}: ${printType(a.type)}`);
        const argsStr = renderedArgs.length > 0 ? `(${renderedArgs.join(', ')})` : '';
        fieldLines.push(`  ${fname}${argsStr}: ${printType(fdef.type)}`);
    }
    if (fieldLines.length === 0) return `${kw} ${t.name}${ifaces}`;
    return `${kw} ${t.name}${ifaces} {\n${fieldLines.join('\n')}\n}`;
}

function emitInput(t: import('graphql').GraphQLInputObjectType, ctx: EmitContext): string {
    const kept = ctx.keptInputFields.get(t.name);
    const fields = Object.values(t.getFields())
        .filter((f) => !ctx.stripDeprecated || !isDeprecated(f))
        .filter((f) => !ctx.relevance || !kept || kept.has(f.name))
        .map((f) => `  ${f.name}: ${printType(f.type)}`);
    // An empty-braced `input X {}` is invalid SDL. When every field was pruned,
    // emit a bare `input X` stub (still a valid, referenceable type).
    if (fields.length === 0) return `input ${t.name}`;
    return `input ${t.name} {\n${fields.join('\n')}\n}`;
}

function emitEnum(t: import('graphql').GraphQLEnumType, ctx: EmitContext): string {
    const values = t.getValues().filter((v) => !ctx.stripDeprecated || !isDeprecated(v));
    let kept = values;
    if (ctx.relevance) {
        const rel = ctx.relevance;
        kept = values.filter((v) => rel(`enum:${t.name}.${v.name}`) >= ctx.enumFloor);
        if (kept.length === 0 && values.length > 0 && !ctx.explicitMembers) {
            // Never emit an empty enum — keep the single highest-relevance value.
            let best = values[0]!;
            let bestScore = rel(`enum:${t.name}.${best.name}`);
            for (const v of values) {
                const s = rel(`enum:${t.name}.${v.name}`);
                if (s > bestScore) {
                    bestScore = s;
                    best = v;
                }
            }
            kept = [best];
        }
    }
    // Explicit-members mode with no kept values ⇒ bare `enum X` stub (still a
    // valid type reference, no body).
    if (kept.length === 0) return `enum ${t.name}`;
    const vals = kept.map((v) => `  ${v.name}`).join('\n');
    return `enum ${t.name} {\n${vals}\n}`;
}

function printType(t: import('graphql').GraphQLType): string {
    return String(t);
}

// Re-export to avoid an unused-imports warning when graphql changes.
export { isInputType, print };
