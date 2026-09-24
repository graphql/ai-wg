/**
 * `coord-return` template — "Type.field -> ReturnType".
 *
 * Same head as the default template but drops the description suffix. Tests
 * whether the return-type signal alone (without prose) is enough.
 *
 * SELF-CONTAINED: only imports from ../../core/types.ts.
 */
import type { FieldDef, TemplateContext } from '../../core/types.ts';

export function render(field: FieldDef, _ctx: TemplateContext): string {
    return `${field.coord} -> ${field.returnType}`;
}
