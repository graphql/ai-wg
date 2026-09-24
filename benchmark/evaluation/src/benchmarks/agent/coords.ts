/**
 * Coordinate extraction + must classification for the agent benchmark.
 *
 * `submittedCoords` collects the field/arg coordinates a MODEL-SUBMITTED GraphQL
 * query actually traverses, so the validator (validator.ts) can check the query
 * covers every `mustInclude` coordinate. It walks ONLY selections reachable from
 * an operation root (fragment spreads resolved, unused fragments ignored) so a
 * defined-but-unspread fragment can't "cover" a missing coord (R3).
 *
 * `classifyMusts` separates structurally-unsatisfiable musts (bare UNION type
 * names — never produced by a field walk) from satisfiable ones (R1).
 *
 * Coord formats match the corpus `mustInclude`:
 *   - `Type.field`          object/interface field traversal (~66%)
 *   - `Type.field(arg:)`    argument presence (trailing ':', no value) (~34%)
 *   - bare `Type`           only the 6 bare-union musts (unsatisfiable)
 */
import {
    parse,
    visit,
    visitWithTypeInfo,
    TypeInfo,
    Kind,
    isUnionType,
    isInterfaceType,
    isObjectType,
    type GraphQLSchema,
    type DocumentNode,
    type SelectionSetNode,
    type FragmentDefinitionNode,
    type GraphQLNamedType,
} from 'graphql';
import { operationCoords } from '../../../scripts/op-coords.ts';

/** Type names related to `typeName` by the interface/implementation relation that
 *  ALSO declare `fieldName`. Selecting `field` on an interface genuinely traverses
 *  that field for every concrete implementor at runtime (and a concrete selection
 *  satisfies the interface's contract), so `Interface.field` and `Impl.field` are
 *  the SAME traversal. The coverage gate must treat them as equivalent — otherwise
 *  the natural `connection{edges{node{field}}}` query (node typed as the interface)
 *  is marked "missing" a concrete must it actually covers. Walks both up (implemented
 *  interfaces) and down (implementors), transitively, field-name-gated throughout so
 *  it can only ever credit the identical field. */
function relatedFieldOwners(schema: GraphQLSchema, typeName: string, fieldName: string): string[] {
    const start = schema.getType(typeName);
    if (!start || (!isInterfaceType(start) && !isObjectType(start))) return [];
    const out = new Set<string>();
    const hasField = (t: GraphQLNamedType): boolean =>
        (isInterfaceType(t) || isObjectType(t)) && fieldName in t.getFields();
    const up = (t: GraphQLNamedType): void => {
        if (!isInterfaceType(t) && !isObjectType(t)) return;
        for (const iface of t.getInterfaces()) {
            if (hasField(iface) && !out.has(iface.name)) {
                out.add(iface.name);
                up(iface);
            }
        }
    };
    const down = (t: GraphQLNamedType): void => {
        if (!isInterfaceType(t)) return;
        const impls = schema.getImplementations(t);
        for (const o of [...impls.objects, ...impls.interfaces]) {
            if (hasField(o) && !out.has(o.name)) {
                out.add(o.name);
                down(o);
            }
        }
    };
    up(start);
    down(start);
    out.delete(typeName);
    return [...out];
}

/** Field/arg coordinates a submitted query traverses (spread-reachable only). */
export function submittedCoords(schema: GraphQLSchema, operation: string): Set<string> {
    const out = new Set<string>();
    let ast: DocumentNode;
    try {
        ast = parse(operation);
    } catch {
        return out;
    }

    // Index named fragments; compute the set transitively spread from operations.
    const fragDefs = new Map<string, FragmentDefinitionNode>();
    for (const def of ast.definitions) {
        if (def.kind === Kind.FRAGMENT_DEFINITION) fragDefs.set(def.name.value, def);
    }
    const reachable = new Set<string>();
    const collectSpreads = (sel: SelectionSetNode): void => {
        for (const s of sel.selections) {
            if (s.kind === Kind.FRAGMENT_SPREAD) {
                const name = s.name.value;
                if (!reachable.has(name)) {
                    reachable.add(name);
                    const fd = fragDefs.get(name);
                    if (fd) collectSpreads(fd.selectionSet);
                }
            } else if (s.selectionSet) {
                collectSpreads(s.selectionSet); // Field / InlineFragment
            }
        }
    };
    for (const def of ast.definitions) {
        if (def.kind === Kind.OPERATION_DEFINITION) collectSpreads(def.selectionSet);
    }

    // Prune to operations + reachable fragments, then a TypeInfo walk emits coords.
    // Unused fragment definitions are dropped, so they contribute nothing (R3).
    const pruned: DocumentNode = {
        ...ast,
        definitions: ast.definitions.filter(
            (d) =>
                d.kind === Kind.OPERATION_DEFINITION ||
                (d.kind === Kind.FRAGMENT_DEFINITION && reachable.has(d.name.value)),
        ),
    };

    const ti = new TypeInfo(schema);
    visit(
        pruned,
        visitWithTypeInfo(ti, {
            Field(node) {
                const parent = ti.getParentType();
                const fdef = ti.getFieldDef();
                if (!parent || !fdef || fdef.name.startsWith('__')) return; // skip introspection
                out.add(`${parent.name}.${fdef.name}`);
                for (const arg of node.arguments ?? []) {
                    out.add(`${parent.name}.${fdef.name}(${arg.name.value}:)`);
                }
            },
        }),
    );

    // Union the input-object / argument closure (bare input type names, Input.field,
    // required-field closures) that operationCoords emits from passed arguments.
    for (const c of operationCoords(schema, operation)) out.add(c);

    // Credit the interface/implementation equivalents of every field coord: a field
    // selected through an interface (`node{quantity}` where node is the interface)
    // covers the concrete-type must `Impl.quantity`, and vice-versa. Field-name-gated,
    // so it only ever credits the identical field on a related type.
    for (const c of [...out]) {
        const m = /^([^.(]+)\.([^.(]+)(\(.*\))?$/.exec(c);
        if (!m) continue;
        const [, type, field, arg = ''] = m;
        for (const owner of relatedFieldOwners(schema, type!, field!)) {
            out.add(`${owner}.${field}${arg}`);
        }
    }
    return out;
}

export interface MustClassification {
    satisfiable: string[]; // graded by the coverage gate
    unsatisfiable: string[]; // bare-union musts no field walk can produce
    isUnsatisfiableQuery: boolean; // unsatisfiable.length > 0
}

/** A must is unsatisfiable iff it is a BARE type name (no '.' / '(') that resolves
 *  to a UNION in the schema — a union name is never emitted by a Type.field walk,
 *  and operationCoords only emits bare INPUT type names, so no model output can
 *  cover it. Yields exactly the 6 known rows (PinnableItem, ProjectV2ItemFieldValue,
 *  DiscountCustomerSelection). */
export function classifyMusts(
    schema: GraphQLSchema,
    mustInclude: ReadonlyArray<string>,
): MustClassification {
    const satisfiable: string[] = [];
    const unsatisfiable: string[] = [];
    for (const m of mustInclude) {
        if (!m.includes('.') && !m.includes('(')) {
            const named = schema.getType(m);
            if (named && isUnionType(named)) {
                unsatisfiable.push(m);
                continue;
            }
        }
        satisfiable.push(m);
    }
    return { satisfiable, unsatisfiable, isUnsatisfiableQuery: unsatisfiable.length > 0 };
}
