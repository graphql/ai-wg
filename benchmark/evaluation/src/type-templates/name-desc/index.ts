/**
 * Default type template: "<Type> — <description>" (description optional).
 *
 * Identical text-shape to the harness pre-refactor (was hardcoded as
 * `defaultRenderType` in core/snapshot.ts). When a type has no description we
 * drop the " — desc" suffix — matching old behavior so cached embeddings stay
 * valid.
 *
 * SELF-CONTAINED: only imports from ../../core/types.ts. Type templates are
 * pure render functions; no algorithm code, no shared infra.
 */
import type { TypeDef, TypeTemplateContext } from '../../core/types.ts';

export function render(type: TypeDef, ctx: TypeTemplateContext): string {
    const desc = ctx.descriptionForType(type.name);
    return desc ? `${type.name} — ${desc}` : type.name;
}
