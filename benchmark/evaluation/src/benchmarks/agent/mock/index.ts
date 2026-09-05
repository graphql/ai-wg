/**
 * Public API for the deterministic in-process GraphQL mock server.
 *
 * `makeMockServer(schema, resolverMap)` attaches the per-schema resolver map ONCE onto the passed
 * schema, then returns a {@link MockServer} whose `execute()` runs graphql-js with a fresh store per
 * call. The `coverage` recorder PERSISTS across `execute()` calls so a whole run aggregates the
 * generic-resolution gaps.
 */
import type { GraphQLSchema } from 'graphql';
import type { MockServer, ResolverMap } from './types.ts';
import { attachResolvers } from './attach.ts';
import { createCoverageRecorder } from './coverage.ts';
import { runExecute } from './executor.ts';

export type {
    Entity,
    MockContext,
    Resolver,
    ResolverMap,
    ConnectionOpts,
    EntityStore,
    CoverageRecorder,
    MockServer,
} from './types.ts';

/** Build a mock server: attach resolvers once, return a server with a persistent coverage recorder. */
export function makeMockServer(schema: GraphQLSchema, resolverMap: ResolverMap): MockServer {
    attachResolvers(schema, resolverMap);
    const coverage = createCoverageRecorder();
    return {
        coverage,
        execute(query: string, variables?: Record<string, unknown>) {
            return runExecute(schema, coverage, query, variables);
        },
    };
}
