/**
 * `sig-desc` template — signature concatenated with description.
 *
 * Combines `sig` (Parent.field: ReturnType[]!) with the field description
 * separated by an em-dash. Falls back to the bare signature when the field
 * has no description.
 *
 * CAVEAT — like `sig`, arg lists are not rendered. FieldDef does not carry
 * argument metadata in the eval snapshot. See README.
 *
 * SELF-CONTAINED: only imports from ../../core/types.ts.
 */
import type { FieldDef, TemplateContext } from '../../core/types.ts';

export function render(field: FieldDef, ctx: TemplateContext): string {
    const listSuffix = field.isList ? '[]' : '';
    const nonNullSuffix = field.isNonNull ? '!' : '';
    const sig = `${field.parent}.${field.field}: ${field.returnType}${listSuffix}${nonNullSuffix}`;
    const desc = ctx.descriptionFor(field.coord);
    return desc ? `${sig} — ${desc}` : sig;
}
