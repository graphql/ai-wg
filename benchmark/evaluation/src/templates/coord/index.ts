/**
 * `coord` template — embed just the bare coordinate string "Type.field".
 *
 * Minimal-signal baseline. No return type, no description. Useful as a floor
 * for what cosine similarity can do off pure naming.
 *
 * SELF-CONTAINED: only imports from ../../core/types.ts.
 */
import type { FieldDef, TemplateContext } from '../../core/types.ts';

export function render(field: FieldDef, _ctx: TemplateContext): string {
    return field.coord;
}
