/**
 * `name-only` template — embed just the field name.
 *
 * The hardest floor: no parent type, no return type, no description. Two
 * different parents with the same field name produce identical embedding
 * text — which is exactly the point of this baseline.
 *
 * SELF-CONTAINED: only imports from ../../core/types.ts.
 */
import type { FieldDef, TemplateContext } from '../../core/types.ts';

export function render(field: FieldDef, _ctx: TemplateContext): string {
    return field.field;
}
