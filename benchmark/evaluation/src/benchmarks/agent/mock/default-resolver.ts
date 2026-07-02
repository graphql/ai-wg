/**
 * The execute() `fieldResolver` FALLBACK — graphql-js calls it ONLY for fields that have no
 * `.resolve` of their own (i.e. fields not in the per-schema ResolverMap).
 *
 * Behaviour:
 *  1) if `source[fieldName]` is present (INCLUDING an explicit `null`) → return it. This serves
 *     every authored scalar, object ref, plain list, and shaped-connection prop.
 *  2) otherwise the field is NOT MOCKED → THROW, naming the exact `ParentType.field` and entity.
 *
 * Rationale: each schema mock is a natural object-graph server; it must author every queried field
 * on its entities (use an explicit `null` for an intentionally-empty value). The old fallback
 * fabricated a deterministic seeded value for any absent field, which silently hid coverage gaps
 * behind plausible-looking data. Failing loud forces the mock to actually contain the data.
 */
import type { GraphQLResolveInfo } from 'graphql';
import type { MockContext } from './types.ts';

/** The fallback field resolver passed to graphql-js `execute({ fieldResolver })`. */
export function defaultResolver(
    source: any,
    args: Record<string, any>,
    ctx: MockContext,
    info: GraphQLResolveInfo,
): unknown {
    const parentName = info.parentType.name;
    const field = info.fieldName;

    // ALWAYS record so unmapped fields (and any args we ignore) surface as coverage gaps.
    ctx.coverage.record(parentName, field, Object.keys(args ?? {}));

    // (1) honor a value already authored on the source entity (incl. an explicit null).
    if (source != null && typeof source === 'object' && field in source) {
        return (source as Record<string, unknown>)[field];
    }

    // (2) not mocked → fail loud with the exact location.
    const id =
        source != null && typeof source === 'object'
            ? ((source as { id?: unknown; __typename?: unknown }).id ??
              (source as { __typename?: unknown }).__typename ??
              '?')
            : String(source);
    throw new Error(
        `Unmocked field ${parentName}.${field} on ${String(id)} — author it on the ${parentName} ` +
            `entity in the mock (use an explicit null if it is intentionally empty).`,
    );
}
