import type { ResolverMap } from '../types.ts';
import { github } from './github.ts';
import { gitlab } from './gitlab.ts';
import { linear } from './linear.ts';
import { shopify } from './shopify.ts';
import { singapore } from './singapore.ts';

/** The per-schema resolver map for a schema id. */
export function resolverMapFor(schemaId: string): ResolverMap {
    switch (schemaId) {
        case 'github':
            return github;
        case 'gitlab':
            return gitlab;
        case 'linear':
            return linear;
        case 'shopify':
            return shopify;
        case 'singapore':
            return singapore;
        default:
            return {};
    }
}
