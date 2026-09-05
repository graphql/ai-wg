/**
 * Type template: "<Type> { f1 f2 ... }" — the type name plus its field names.
 *
 * Surfaces the type's shape (its member fields) instead of its prose
 * description, on the theory that a query naming concrete fields cosine-matches
 * a type whose field names it mentions. Field names are capped at the first 30
 * to bound the embedding token count — wide types (hundreds of fields) would
 * otherwise blow past the model's context and dilute the signal.
 *
 * SELF-CONTAINED: only imports from ../../core/types.ts. Type templates are
 * pure render functions; no algorithm code, no shared infra.
 */
import type { TypeDef, TypeTemplateContext } from '../../core/types.ts';

/** Cap on field names rendered per type — keeps the embedded text bounded. */
const MAX_FIELDS = 30;

export function render(type: TypeDef, _ctx: TypeTemplateContext): string {
    return `${type.name} { ${type.fieldNames.slice(0, MAX_FIELDS).join(' ')} }`;
}
