/**
 * WORKAROUND — not part of the qwen3-emb-graphql contribution.
 *
 * `src/benchmarks/agent/coords.ts` imports this file, but PR #140
 * (graphql/ai-wg) did not commit a `scripts/op-coords.ts`. Without
 * SOMETHING at this path the CLI fails to load and no benchmark can run.
 *
 * The real `operationCoords(schema, operation)` is meant to walk a GraphQL
 * operation document and emit the Type.field / Input.field / argument-name
 * coordinates it touches, so the agent coverage gate can credit a must-include
 * satisfied through an interface or input-object closure rather than a direct
 * field reference. This stub returns nothing, which is harmless for every
 * benchmark EXCEPT `agent` — `models`, `templates`, `type-templates`, and
 * `strategies` never call into it.
 *
 * The PR author should replace this with the real implementation; nothing in
 * this branch depends on the behaviour.
 */
import type { GraphQLSchema } from 'graphql';

export function operationCoords(_schema: GraphQLSchema, _operation: string): Iterable<string> {
    return [];
}
