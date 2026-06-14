/**
 * The agent benchmark validator. Mimics a real GraphQL endpoint: a model-submitted
 * query is parsed + validated against the FULL schema and the result is EXACTLY what
 * a GraphQL API would return — nothing more:
 *   - parse error    → a GraphQL `errors` payload (syntax error + location)
 *   - validate error → a GraphQL `errors` payload (one entry per validation error)
 *   - valid          → accepted; we ALSO compute (silently, never shown to the model)
 *                      which satisfiable `mustInclude` coords it traverses, for grading.
 *
 * CRITICAL: the validator NEVER tells the model anything about coverage, required
 * coordinates, or "what's missing". That is the hidden oracle — leaking it turns the
 * benchmark into "act on the answer key" instead of "translate the question into a
 * correct query". The `covered` list is returned to the SESSION for silent grading
 * only; the session's model-facing response is a plain GraphQL data/errors envelope.
 *
 * Pruning unused fragments happens inside submittedCoords (coords.ts), so coverage
 * never depends on validate() rejecting unused fragments (R3).
 */
import { parse, validate, specifiedRules, GraphQLError, type GraphQLSchema } from 'graphql';
import { submittedCoords } from './coords.ts';

/** One GraphQL error as a real endpoint serializes it (message + source locations). */
export interface GraphQLErrorEntry {
    message: string;
    locations?: ReadonlyArray<{ line: number; column: number }>;
}

export type ValidatorResult =
    | { ok: true; covered: string[] } // VALID; `covered` = musts traversed (SILENT — grading only)
    | { ok: false; kind: 'parse' | 'validate'; errors: GraphQLErrorEntry[] };

export interface Validator {
    /** Validate a model query: parse + schema-validate. A VALID query returns the
     *  subset of `mustInclude` it traverses (`covered`) for the session's SILENT
     *  grading — never surfaced to the model. An INVALID query returns the raw
     *  GraphQL error entries, exactly as an API would. */
    check(submitted: string): ValidatorResult;
}

/** Build a validator. `mustInclude` MUST be the SATISFIABLE must list
 *  (classifyMusts(...).satisfiable) — bare-union musts are carved out upstream. */
export function makeValidator(opts: {
    schema: GraphQLSchema;
    mustInclude: ReadonlyArray<string>;
}): Validator {
    const { schema } = opts;
    const must = [...opts.mustInclude];
    return {
        check(submitted: string): ValidatorResult {
            // 1. parse — a real endpoint returns the syntax error + its location.
            let doc;
            try {
                doc = parse(submitted);
            } catch (e) {
                return { ok: false, kind: 'parse', errors: [errorEntry(e)] };
            }
            // 2. validate — semantic errors against the schema, one entry each.
            const errors = validate(schema, doc, specifiedRules);
            if (errors.length > 0) {
                return { ok: false, kind: 'validate', errors: errors.map(errorEntry) };
            }
            // 3. valid — silently report which required coords this query covers
            //    (the session decides success from the ACCUMULATED coverage and never
            //    reveals it to the model).
            const used = submittedCoords(schema, submitted);
            const covered = must.filter((m) => used.has(m));
            return { ok: true, covered };
        },
    };
}

/** Project a thrown/collected GraphQL error to the {message, locations} shape a
 *  real endpoint serializes in its `errors` array. */
function errorEntry(e: unknown): GraphQLErrorEntry {
    if (e instanceof GraphQLError) {
        const locations = e.locations?.map((l) => ({ line: l.line, column: l.column }));
        return locations && locations.length
            ? { message: e.message, locations }
            : { message: e.message };
    }
    return { message: e instanceof Error ? e.message : String(e) };
}
