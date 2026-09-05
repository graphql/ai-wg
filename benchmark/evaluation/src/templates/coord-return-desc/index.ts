/**
 * Default template: "<Type>.<field> -> <ReturnType> — <description>".
 *
 * Identical text-shape to the harness pre-refactor (was hardcoded in
 * core/snapshot.ts). When a field has no description we drop the " — desc"
 * suffix — matching old behavior so cached embeddings stay valid.
 *
 * SELF-CONTAINED: only imports from ../../core/types.ts. Templates are pure
 * render functions; no algorithm code, no shared infra.
 */
import type { FieldDef, TemplateContext } from '../../core/types.ts';

export function render(field: FieldDef, ctx: TemplateContext): string {
    const head = `${field.coord} -> ${field.returnType}`;
    const desc = ctx.descriptionFor(field.coord);
    return desc ? `${head} — ${desc}` : head;
}
