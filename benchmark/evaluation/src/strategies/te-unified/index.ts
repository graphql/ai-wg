/**
 * te-unified — one greedy best-first selector over a UNIFIED member pool.
 *
 * Every type-system member is treated as one kind of "coordinate" in a single
 * embedding space:
 *   - a FIELD          (key = coord "T.f",            cos = cosineToQuery)
 *   - an ARGUMENT      (key = "arg:T.f(a)",           cos = cosineToQueryElements)
 *   - an INPUT FIELD   (key = "in:InputType.field",   cos = cosineToQueryElements)
 *   - an ENUM VALUE    (key = "enum:EnumType.VALUE",  cos = cosineToQueryElements)
 *
 * ONE best-first frontier (max-heap by cos) decides which members appear. The
 * selection itself — not a per-kind cosine floor — determines which args /
 * input-fields / enum values make it into the slice. We seed the frontier with
 * the structural entry points (root fields + the fields of the most relevant
 * types), then pop the highest-cos member, admit it, and enqueue the members it
 * structurally unlocks, until an admitted-member budget is reached.
 *
 * Required args / input-fields of admitted fields/inputs are always admitted
 * (even at low cos) so the rendered slice stays a usable schema.
 *
 * Returns:
 *   selectedCoords  — admitted FIELD coords (drive the slice's type/field set)
 *   selectedMembers — admitted arg/in/enum keys (the slice renders exactly these)
 *
 * Self-contained: the only project import is the public contract in
 * ../../core/types.ts. The GraphQL SDL is parsed with the standard `graphql`
 * package (a third-party dependency, not a sibling core/strategy module) to
 * recover the structure the snapshot doesn't expose verbatim (argument input
 * types, input-object field types, enum values, required-ness). It does NOT
 * read query.mustInclude / shouldInclude / mustExclude.
 */

import {
    buildSchema,
    getNamedType,
    isEnumType,
    isInputObjectType,
    isInterfaceType,
    isNonNullType,
    isObjectType,
    type GraphQLSchema,
} from 'graphql';
import type { SchemaSnapshot, StrategyInput, StrategyResult } from '../../core/types.ts';

// ─── Config ───────────────────────────────────────────────────────────────

interface Cfg {
    maxMembers: number;
    typesTopK: number;
    seedRootFields: boolean;
    returnTypeExpansion: boolean;
}

function readCfg(raw: Record<string, unknown>): Cfg {
    const c = raw ?? {};
    const num = (k: string, d: number): number => {
        const v = c[k];
        return typeof v === 'number' && Number.isFinite(v) ? v : d;
    };
    const bool = (k: string, d: boolean): boolean => {
        const v = c[k];
        return typeof v === 'boolean' ? v : d;
    };
    return {
        maxMembers: Math.trunc(num('maxMembers', 1500)),
        typesTopK: Math.trunc(num('typesTopK', 15)),
        seedRootFields: bool('seedRootFields', true),
        returnTypeExpansion: bool('returnTypeExpansion', true),
    };
}

// ─── Structural model parsed from the SDL ─────────────────────────────────

interface ArgInfo {
    name: string;
    key: string; // "arg:T.f(a)"
    inputTypeName: string; // unwrapped named type of the argument
    required: boolean; // NonNull && no default
}

interface InputFieldInfo {
    name: string;
    key: string; // "in:InputType.field"
    typeName: string; // unwrapped named type of the input field
    required: boolean; // NonNull && no default
}

interface Structure {
    /** "T.f" → its arguments */
    argsByField: Map<string, ArgInfo[]>;
    /** "T.f" → unwrapped return type name */
    returnByField: Map<string, string>;
    /** InputType name → its fields */
    fieldsByInput: Map<string, InputFieldInfo[]>;
    /** EnumType name → its value keys ("enum:E.V") */
    valuesByEnum: Map<string, string[]>;
    /** types that are object or interface (have selectable fields) */
    objectLike: Set<string>;
    /** types that are enums */
    enums: Set<string>;
    /** types that are input objects */
    inputs: Set<string>;
    /** query-root type name(s) */
    queryRoots: Set<string>;
}

function parseStructure(snap: SchemaSnapshot): Structure {
    const schema: GraphQLSchema = buildSchema(snap.schema.sdl, { assumeValid: true });
    const typeMap = schema.getTypeMap();

    const argsByField = new Map<string, ArgInfo[]>();
    const returnByField = new Map<string, string>();
    const fieldsByInput = new Map<string, InputFieldInfo[]>();
    const valuesByEnum = new Map<string, string[]>();
    const objectLike = new Set<string>();
    const enums = new Set<string>();
    const inputs = new Set<string>();

    for (const [typeName, gqlType] of Object.entries(typeMap)) {
        if (typeName.startsWith('__')) continue;
        if (isObjectType(gqlType) || isInterfaceType(gqlType)) {
            objectLike.add(typeName);
            for (const [fname, fdef] of Object.entries(gqlType.getFields())) {
                const coord = `${typeName}.${fname}`;
                returnByField.set(coord, getNamedType(fdef.type).name);
                const args: ArgInfo[] = [];
                for (const a of fdef.args) {
                    args.push({
                        name: a.name,
                        key: `arg:${typeName}.${fname}(${a.name})`,
                        inputTypeName: getNamedType(a.type).name,
                        required: isNonNullType(a.type) && a.defaultValue === undefined,
                    });
                }
                if (args.length > 0) argsByField.set(coord, args);
            }
        } else if (isInputObjectType(gqlType)) {
            inputs.add(typeName);
            const fields: InputFieldInfo[] = [];
            for (const [fname, fdef] of Object.entries(gqlType.getFields())) {
                fields.push({
                    name: fname,
                    key: `in:${typeName}.${fname}`,
                    typeName: getNamedType(fdef.type).name,
                    required: isNonNullType(fdef.type) && fdef.defaultValue === undefined,
                });
            }
            fieldsByInput.set(typeName, fields);
        } else if (isEnumType(gqlType)) {
            enums.add(typeName);
            valuesByEnum.set(
                typeName,
                gqlType.getValues().map((v) => `enum:${typeName}.${v.name}`),
            );
        }
    }

    return {
        argsByField,
        returnByField,
        fieldsByInput,
        valuesByEnum,
        objectLike,
        enums,
        inputs,
        queryRoots: queryRootTypes(snap),
    };
}

/**
 * Query-root type name(s). The snapshot's `rootTypes` is built from the
 * schema's actual operation types (so a renamed root like shopify's `QueryRoot`
 * is included) — we just drop Mutation/Subscription and, defensively, add any
 * literal Query/QueryRoot type present. Never hardcodes 'Query' alone.
 */
function queryRootTypes(snap: SchemaSnapshot): Set<string> {
    const out = new Set<string>();
    for (const t of snap.rootTypes) {
        if (t === 'Mutation' || t === 'Subscription') continue;
        out.add(t);
    }
    for (const candidate of ['Query', 'QueryRoot']) {
        if (snap.fieldsByType.has(candidate)) out.add(candidate);
    }
    return out;
}

// ─── Max-heap over (key, cos) ─────────────────────────────────────────────

interface HeapItem {
    key: string;
    cos: number;
}

class MaxHeap {
    private readonly a: HeapItem[] = [];
    get size(): number {
        return this.a.length;
    }
    push(item: HeapItem): void {
        const a = this.a;
        a.push(item);
        let i = a.length - 1;
        while (i > 0) {
            const p = (i - 1) >> 1;
            if (a[p]!.cos >= a[i]!.cos) break;
            [a[p], a[i]] = [a[i]!, a[p]!];
            i = p;
        }
    }
    pop(): HeapItem | undefined {
        const a = this.a;
        if (a.length === 0) return undefined;
        const top = a[0]!;
        const last = a.pop()!;
        if (a.length > 0) {
            a[0] = last;
            let i = 0;
            const n = a.length;
            for (;;) {
                const l = 2 * i + 1;
                const r = 2 * i + 2;
                let m = i;
                if (l < n && a[l]!.cos > a[m]!.cos) m = l;
                if (r < n && a[r]!.cos > a[m]!.cos) m = r;
                if (m === i) break;
                [a[m], a[i]] = [a[i]!, a[m]!];
                i = m;
            }
        }
        return top;
    }
}

// ─── Strategy entry point ─────────────────────────────────────────────────

export function run(input: StrategyInput): StrategyResult {
    const cfg = readCfg(input.config);
    const snap = input.snapshot;
    const st = parseStructure(snap);

    const fieldCos = snap.cosineToQuery(input.query.embedding);
    const elemCos = snap.cosineToQueryElements(input.query.embedding);

    // cos lookup unified across both axes. Field keys are plain "T.f"; member
    // keys carry an "arg:"/"in:"/"enum:" prefix.
    function cosOf(key: string): number {
        if (key.startsWith('arg:') || key.startsWith('in:') || key.startsWith('enum:')) {
            return elemCos.get(key) ?? 0;
        }
        return fieldCos.get(key) ?? 0;
    }

    const frontier = new MaxHeap();
    const enqueued = new Set<string>(); // ever pushed (de-dups frontier)
    const admittedFields = new Set<string>(); // field coords
    const admittedMembers = new Set<string>(); // arg/in/enum keys
    let admittedCount = 0;

    function enqueue(key: string): void {
        if (enqueued.has(key)) return;
        enqueued.add(key);
        frontier.push({ key, cos: cosOf(key) });
    }

    // ── Seeding ────────────────────────────────────────────────────────────
    // Root-type fields + the fields of the top typesTopK cosine-relevant types
    // (type relevance = max field cos in that type).
    if (cfg.seedRootFields) {
        for (const root of st.queryRoots) {
            for (const f of snap.fieldsByType.get(root) ?? []) enqueue(f.coord);
        }
    }
    const typeRelevance: Array<{ type: string; score: number }> = [];
    for (const [type, fields] of snap.fieldsByType) {
        if (st.queryRoots.has(type)) continue;
        let mx = 0;
        for (const f of fields) {
            const c = fieldCos.get(f.coord) ?? 0;
            if (c > mx) mx = c;
        }
        typeRelevance.push({ type, score: mx });
    }
    typeRelevance.sort((a, b) => b.score - a.score || a.type.localeCompare(b.type));
    for (const { type } of typeRelevance.slice(0, Math.max(0, cfg.typesTopK))) {
        for (const f of snap.fieldsByType.get(type) ?? []) enqueue(f.coord);
    }

    // ── Admission helpers ────────────────────────────────────────────────────

    function admitField(coord: string): void {
        if (admittedFields.has(coord)) return;
        admittedFields.add(coord);
        admittedCount++;

        // Required args are always admitted so the slice stays usable; optional
        // args are enqueued to compete on cos.
        for (const arg of st.argsByField.get(coord) ?? []) {
            if (arg.required) {
                admitMember(arg.key);
                if (st.inputs.has(arg.inputTypeName)) enqueueInputFields(arg.inputTypeName);
            } else {
                enqueue(arg.key);
            }
        }

        // Expand the return type: object/interface ⇒ its fields; enum ⇒ its values.
        if (cfg.returnTypeExpansion) {
            const rt = st.returnByField.get(coord);
            if (rt) {
                if (st.objectLike.has(rt)) {
                    for (const f of snap.fieldsByType.get(rt) ?? []) enqueue(f.coord);
                } else if (st.enums.has(rt)) {
                    for (const v of st.valuesByEnum.get(rt) ?? []) enqueue(v);
                }
            }
        }
    }

    function admitMember(key: string): void {
        if (admittedMembers.has(key)) return;
        admittedMembers.add(key);
        admittedCount++;
    }

    /** Enqueue an input type's fields; required ones are admitted immediately. */
    function enqueueInputFields(inputType: string): void {
        for (const inf of st.fieldsByInput.get(inputType) ?? []) {
            if (inf.required) {
                admitMember(inf.key);
                if (st.inputs.has(inf.typeName)) enqueueInputFields(inf.typeName);
            } else {
                enqueue(inf.key);
            }
        }
    }

    function findArg(key: string): { parentCoord: string; arg: ArgInfo } | null {
        // key = "arg:T.f(a)" → parent coord "T.f"
        const inner = key.slice(4); // strip "arg:"
        const paren = inner.indexOf('(');
        if (paren < 0) return null;
        const parentCoord = inner.slice(0, paren);
        const args = st.argsByField.get(parentCoord);
        if (!args) return null;
        const arg = args.find((a) => a.key === key);
        return arg ? { parentCoord, arg } : null;
    }

    function findInputField(key: string): InputFieldInfo | null {
        // key = "in:InputType.field"
        const inner = key.slice(3); // strip "in:"
        const dot = inner.lastIndexOf('.');
        if (dot < 0) return null;
        const inputType = inner.slice(0, dot);
        const fields = st.fieldsByInput.get(inputType);
        return fields?.find((f) => f.key === key) ?? null;
    }

    // ── Best-first loop ──────────────────────────────────────────────────────
    while (admittedCount < cfg.maxMembers && frontier.size > 0) {
        const top = frontier.pop()!;
        const key = top.key;

        if (key.startsWith('arg:')) {
            if (admittedMembers.has(key)) continue;
            const found = findArg(key);
            if (!found) continue;
            // Ensure the owning field is admitted first.
            admitField(found.parentCoord);
            if (admittedCount >= cfg.maxMembers) break;
            admitMember(key);
            if (st.inputs.has(found.arg.inputTypeName)) enqueueInputFields(found.arg.inputTypeName);
        } else if (key.startsWith('in:')) {
            if (admittedMembers.has(key)) continue;
            const inf = findInputField(key);
            if (!inf) continue;
            admitMember(key);
            if (st.inputs.has(inf.typeName)) enqueueInputFields(inf.typeName);
        } else if (key.startsWith('enum:')) {
            admitMember(key);
        } else {
            admitField(key);
        }
    }

    return {
        selectedCoords: [...admittedFields].sort(),
        selectedMembers: [...admittedMembers].sort(),
    };
}
