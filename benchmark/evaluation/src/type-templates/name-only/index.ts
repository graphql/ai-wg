/**
 * Type template: bare type name, nothing else (e.g. `Commit`).
 *
 * The hard floor for type rendering: no description, no fields — just the
 * name. Useful as a baseline to measure how much the richer renderings buy.
 *
 * SELF-CONTAINED: only imports from ../../core/types.ts. Type templates are
 * pure render functions; no algorithm code, no shared infra.
 */
import type { TypeDef, TypeTemplateContext } from '../../core/types.ts';

export function render(type: TypeDef, _ctx: TypeTemplateContext): string {
    return type.name;
}
