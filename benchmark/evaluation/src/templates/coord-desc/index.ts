/**
 * `coord-desc` template — "Type.field — description" (no return type).
 *
 * Mirrors the default template's behavior of dropping the suffix when no
 * description is available: we fall back to just the coordinate so cached
 * embeddings stay stable when descriptions are missing.
 *
 * SELF-CONTAINED: only imports from ../../core/types.ts.
 */
import type { FieldDef, TemplateContext } from '../../core/types.ts';

export function render(field: FieldDef, ctx: TemplateContext): string {
    const desc = ctx.descriptionFor(field.coord);
    return desc ? `${field.coord} — ${desc}` : field.coord;
}
