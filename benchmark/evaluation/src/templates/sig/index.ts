/**
 * `sig` template — field signature without prose.
 *
 * Renders "Parent.field: ReturnType[]!" with list/non-null markers on the
 * return type when present. Mirrors a SDL-style declaration with one caveat:
 *
 * CAVEAT — args are not rendered. FieldDef carries parent/field/returnType
 * /isList/isNonNull but the eval snapshot does NOT extract argument names or
 * types. A future enhancement could re-parse the SDL inline; for v1 we keep
 * the template self-contained and skip args. See README for impact.
 *
 * SELF-CONTAINED: only imports from ../../core/types.ts.
 */
import type { FieldDef, TemplateContext } from '../../core/types.ts';

export function render(field: FieldDef, _ctx: TemplateContext): string {
    const listSuffix = field.isList ? '[]' : '';
    const nonNullSuffix = field.isNonNull ? '!' : '';
    return `${field.parent}.${field.field}: ${field.returnType}${listSuffix}${nonNullSuffix}`;
}
