/**
 * attachResolvers(schema, map): set NATIVE per-field resolvers on the schema.
 *
 * For each `Type.field` in the map, sets `schema.getType(Type).getFields()[field].resolve = fn`.
 * graphql-js then dispatches per field at query time — our code never looks up a resolver. Missing
 * types/fields are skipped (the map may name fields a given schema does not have). This mutates
 * `field.resolve` on the passed schema, which is fine: the map is static + deterministic.
 */
import {
    isObjectType,
    isInterfaceType,
    type GraphQLSchema,
    type GraphQLFieldResolver,
} from 'graphql';
import type { ResolverMap } from './types.ts';

/** Attach every resolver in `map` onto the matching fields of `schema`. Skips unknown coords. */
export function attachResolvers(schema: GraphQLSchema, map: ResolverMap): void {
    for (const [typeName, fields] of Object.entries(map)) {
        const t = schema.getType(typeName);
        if (!t || (!isObjectType(t) && !isInterfaceType(t))) continue;
        const defs = t.getFields();
        for (const [fieldName, fn] of Object.entries(fields)) {
            const def = defs[fieldName];
            if (def) {
                def.resolve = fn as GraphQLFieldResolver<any, any>;
            }
        }
    }
}
