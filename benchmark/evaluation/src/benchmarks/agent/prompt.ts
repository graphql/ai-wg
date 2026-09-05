/**
 * User-prompt rendering for the agent benchmark. This is FIXED across the prompt
 * axis — it just renders the question the model must answer. The variable
 * instruction surface (system prompt + tool descriptions) lives in the swappable
 * AgentPromptDef (src/agent-prompts/<id>/), loaded by loadAgentPrompts().
 */
import type { QueryDef } from '../../core/types.ts';

/**
 * Render the user prompt for a query. When `query.queries` is present it is the
 * decomposed set of sub-asks (e.g. issues + PRs) — join them into one numbered
 * list so the model sees every ask. Absent ⇒ the single `query.query`. The
 * reference `operation` is NEVER shown (oracle-only).
 */
export function buildUserPrompt(query: QueryDef): string {
    const subs = query.queries;
    if (subs && subs.length > 0) {
        const list = subs.map((q, i) => `${i + 1}. ${q}`).join('\n');
        return `${query.query}\n\n${list}`;
    }
    return query.query;
}
