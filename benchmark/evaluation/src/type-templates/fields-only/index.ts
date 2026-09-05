/**
 * Type template: field names only — no type name, no description.
 *
 * The hard floor in the opposite direction from `name-only`: the embedding
 * text is purely the type's field names (e.g. `oid message author committedDate
 * ...`), dropping even the type's own name. Probes whether the field surface
 * alone is enough to surface a type for a field-naming query. Field names are
 * capped at the first 30 to bound the embedding token count.
 *
 * SELF-CONTAINED: only imports from ../../core/types.ts. Type templates are
 * pure render functions; no algorithm code, no shared infra.
 */
import type { TypeDef, TypeTemplateContext } from '../../core/types.ts';

/** Cap on field names rendered per type — keeps the embedded text bounded. */
const MAX_FIELDS = 30;

export function render(type: TypeDef, _ctx: TypeTemplateContext): string {
    return type.fieldNames.slice(0, MAX_FIELDS).join(' ');
}
