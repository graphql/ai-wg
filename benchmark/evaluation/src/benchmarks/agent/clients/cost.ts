/**
 * Chat-cost computation, centralizing the provider asymmetry in how `inputTokens`
 * relates to cached tokens. Both clients MUST normalize Usage as documented here:
 *
 *   Anthropic: usage.inputTokens = input_tokens (EXCLUDES cache create + read);
 *              cacheCreationInputTokens / cacheReadInputTokens are separate.
 *   OpenAI:    usage.inputTokens = prompt_tokens (INCLUDES the cached subset);
 *              cacheReadInputTokens = prompt_tokens_details.cached_tokens;
 *              cacheCreationInputTokens = 0 (automatic caching, no write charge).
 */
import type { ChatPricing } from '../../../core/types.ts';
import type { Usage } from './types.ts';

const M = 1_000_000;

export function costOf(
    usage: Usage,
    pricing: ChatPricing,
    provider: 'anthropic' | 'openai',
): number {
    if (provider === 'anthropic') {
        return (
            (usage.inputTokens * pricing.inputPerMillion +
                usage.outputTokens * pricing.outputPerMillion +
                usage.cacheCreationInputTokens * pricing.cacheWritePerMillion +
                usage.cacheReadInputTokens * pricing.cacheReadPerMillion) /
            M
        );
    }
    // OpenAI: inputTokens already includes the cached subset → bill uncached at input
    // rate, the cached subset at the discounted cacheRead rate.
    const uncached = Math.max(0, usage.inputTokens - usage.cacheReadInputTokens);
    return (
        (uncached * pricing.inputPerMillion +
            usage.cacheReadInputTokens * pricing.cacheReadPerMillion +
            usage.outputTokens * pricing.outputPerMillion) /
        M
    );
}

/** Sum two usages (for accumulating a session's total). */
export function addUsage(a: Usage, b: Usage): Usage {
    return {
        inputTokens: a.inputTokens + b.inputTokens,
        outputTokens: a.outputTokens + b.outputTokens,
        cacheCreationInputTokens: a.cacheCreationInputTokens + b.cacheCreationInputTokens,
        cacheReadInputTokens: a.cacheReadInputTokens + b.cacheReadInputTokens,
    };
}

export const ZERO_USAGE: Usage = {
    inputTokens: 0,
    outputTokens: 0,
    cacheCreationInputTokens: 0,
    cacheReadInputTokens: 0,
};
