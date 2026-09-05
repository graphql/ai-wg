/**
 * Type template: "<kind> <Type> — <description>" (description optional).
 *
 * Prepends the literal kind word ("object" / "interface") to the name, so the
 * embedding text carries the type's category alongside its name and
 * description (e.g. `object Commit — A Git commit.`). Drops the " — desc"
 * suffix when the type has no description.
 *
 * SELF-CONTAINED: only imports from ../../core/types.ts. Type templates are
 * pure render functions; no algorithm code, no shared infra.
 */
import type { TypeDef, TypeTemplateContext } from '../../core/types.ts';

export function render(type: TypeDef, ctx: TypeTemplateContext): string {
    const head = `${type.kind} ${type.name}`;
    const desc = ctx.descriptionForType(type.name);
    return desc ? `${head} — ${desc}` : head;
}
