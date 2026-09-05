/**
 * makeMockServer internals: run graphql-js `execute()` over the schema with the default
 * fallback resolver and a FRESH store per call.
 *
 * The schema is mutated once (resolvers attached in index.ts) since the map is static. Per-execute
 * isolation is the STORE: each call constructs a new store and passes it via `contextValue`. Because
 * entities are pure functions of their id, separate calls still agree on the same id.
 */
import { execute, parse, type GraphQLSchema, type ExecutionResult } from 'graphql';
import type { CoverageRecorder } from './types.ts';
import { createStore } from './store.ts';
import { defaultResolver } from './default-resolver.ts';

/** Execute one query against `schema`, recording coverage into the shared `coverage`. */
export function runExecute(
    schema: GraphQLSchema,
    coverage: CoverageRecorder,
    query: string,
    variables?: Record<string, unknown>,
): ExecutionResult {
    let document;
    try {
        document = parse(query);
    } catch (err) {
        // Surface a parse failure in the GraphQL { errors } envelope rather than throwing.
        const message = err instanceof Error ? err.message : String(err);
        return { errors: [{ message } as any] };
    }

    const store = createStore();
    const result = execute({
        schema,
        document,
        variableValues: variables,
        contextValue: { store, coverage },
        fieldResolver: defaultResolver,
    });

    // graphql-js execute() is synchronous for a synchronous resolver tree; our resolvers never
    // return promises, so the result is an ExecutionResult, never a Promise.
    return result as ExecutionResult;
}
