/**
 * Anthropic ModelClient (§5.2–§5.6).
 *
 * Maps the provider-agnostic ChatMessage/ToolDef transcript to Anthropic's
 * messages.create wire format, applies prompt caching on the stable
 * `system + tools` prefix, and normalizes usage EXACTLY per cost.ts
 * (Anthropic input_tokens EXCLUDE the cached create/read subset — those are
 * billed via the separate cache_creation/cache_read fields).
 *
 * Lazy-singleton + env-validate pattern mirrors getOpenAIClient in
 * src/core/shared/embeddings.ts: the SDK is dynamic-imported behind a local
 * minimal interface + cast, and the API key is read from the environment.
 */
import type { AgentModelDef } from '../../../core/types.ts';
import type {
    AssistantTurn,
    ChatMessage,
    ContentBlock,
    CreateTurnArgs,
    ModelClient,
    ToolDef,
    ToolUse,
    Usage,
} from './types.ts';

// ─── Minimal Anthropic SDK surface (cast at import; mirrors embeddings.ts) ──

type CacheControl = { type: 'ephemeral' };

interface AnthropicSystemBlock {
    type: 'text';
    text: string;
    cache_control?: CacheControl;
}

interface AnthropicToolParam {
    name: string;
    description: string;
    input_schema: Record<string, unknown>;
    cache_control?: CacheControl;
}

type AnthropicContentBlockParam =
    | { type: 'text'; text: string }
    | { type: 'tool_use'; id: string; name: string; input: unknown }
    | { type: 'tool_result'; tool_use_id: string; content: string; is_error?: boolean };

interface AnthropicMessageParam {
    role: 'user' | 'assistant';
    content: AnthropicContentBlockParam[];
}

type AnthropicResponseBlock =
    | { type: 'text'; text: string }
    | { type: 'tool_use'; id: string; name: string; input: unknown }
    | { type: string; [k: string]: unknown };

interface AnthropicUsage {
    input_tokens: number;
    output_tokens: number;
    cache_creation_input_tokens?: number | null;
    cache_read_input_tokens?: number | null;
}

interface AnthropicMessage {
    content: AnthropicResponseBlock[];
    stop_reason: string | null;
    usage: AnthropicUsage;
}

interface MessageCreateParams {
    model: string;
    max_tokens: number;
    temperature: number;
    system: AnthropicSystemBlock[];
    tools: AnthropicToolParam[];
    messages: AnthropicMessageParam[];
}

interface AnthropicClient {
    messages: { create: (body: MessageCreateParams) => Promise<AnthropicMessage> };
}

interface AnthropicStatusError {
    status?: number;
}

// ─── Lazy singleton + env validation ───────────────────────────────────────

let client: AnthropicClient | null = null;

async function getClient(): Promise<AnthropicClient> {
    if (client) return client;
    const apiKey = process.env['ANTHROPIC_API_KEY'];
    if (!apiKey) {
        throw new Error('ANTHROPIC_API_KEY is required to run the agent benchmark.');
    }
    const { default: A } = await import('@anthropic-ai/sdk');
    client = new A({ apiKey }) as unknown as AnthropicClient;
    return client;
}

// ─── Transcript mapping (ContentBlock ⇆ Anthropic blocks) ──────────────────

function toAnthropicBlock(block: ContentBlock): AnthropicContentBlockParam {
    switch (block.type) {
        case 'text':
            return { type: 'text', text: block.text };
        case 'tool_use':
            return { type: 'tool_use', id: block.id, name: block.name, input: block.input };
        case 'tool_result':
            return {
                type: 'tool_result',
                tool_use_id: block.toolUseId,
                content: block.content,
                ...(block.isError ? { is_error: true } : {}),
            };
    }
}

function toAnthropicMessage(message: ChatMessage): AnthropicMessageParam {
    return { role: message.role, content: message.content.map(toAnthropicBlock) };
}

function mapTools(tools: ToolDef[]): AnthropicToolParam[] {
    // cache_control on the LAST tool caches the whole stable tools-array prefix.
    return tools.map((t, i) => ({
        name: t.name,
        description: t.description,
        input_schema: t.inputSchema,
        ...(i === tools.length - 1 ? { cache_control: { type: 'ephemeral' as const } } : {}),
    }));
}

function mapSystem(system: string): AnthropicSystemBlock[] {
    // Single system block — cache_control on the LAST (only) block caches it.
    return [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }];
}

// ─── Response normalization ─────────────────────────────────────────────────

function normalizeUsage(usage: AnthropicUsage): Usage {
    // EXACT cost.ts contract: Anthropic input_tokens EXCLUDE the cached
    // create/read subset; those are reported separately.
    return {
        inputTokens: usage.input_tokens,
        outputTokens: usage.output_tokens,
        cacheCreationInputTokens: usage.cache_creation_input_tokens ?? 0,
        cacheReadInputTokens: usage.cache_read_input_tokens ?? 0,
    };
}

function extractText(content: AnthropicResponseBlock[]): string {
    return content
        .filter((b): b is { type: 'text'; text: string } => b.type === 'text')
        .map((b) => b.text)
        .join('');
}

function extractToolUses(content: AnthropicResponseBlock[]): ToolUse[] {
    return content
        .filter(
            (b): b is { type: 'tool_use'; id: string; name: string; input: unknown } =>
                b.type === 'tool_use',
        )
        .map((b) => ({ id: b.id, name: b.name, input: b.input }));
}

// ─── Retry policy (§5.6) ─────────────────────────────────────────────────────

const MAX_RETRIES = 8;
const MAX_BACKOFF_MS = 30_000;

function errStatus(err: unknown): number | undefined {
    const s = (err as AnthropicStatusError | undefined)?.status;
    return typeof s === 'number' ? s : undefined;
}

function isRetryable(err: unknown): boolean {
    const status = errStatus(err);
    if (status === undefined) return true; // network / transport error
    return status === 429 || (status >= 500 && status < 600);
}

/** Honour the rate limit's suggested wait (retry-after header or message hint). */
function retryAfterMs(err: unknown): number | undefined {
    const e = err as { headers?: Record<string, string>; message?: string } | null;
    const h = e?.headers;
    if (h) {
        const ms = Number(h['retry-after-ms']);
        if (Number.isFinite(ms) && ms > 0) return ms;
        const s = Number(h['retry-after']);
        if (Number.isFinite(s) && s > 0) return s * 1000;
    }
    const m = /try again in ([\d.]+)\s*s/i.exec(e?.message ?? '');
    if (m) return Math.ceil(parseFloat(m[1]!) * 1000);
    return undefined;
}

function backoffMs(attempt: number, err: unknown): number {
    const expo = 1000 * 2 ** attempt; // 1s/2s/4s/8s/16s
    const hinted = retryAfterMs(err) ?? 0; // respect the limit's own wait
    return Math.min(MAX_BACKOFF_MS, Math.max(expo, hinted)) + Math.floor(Math.random() * 500);
}

function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

// ─── Public factory ──────────────────────────────────────────────────────────

export function makeAnthropicClient(model: AgentModelDef): ModelClient {
    return {
        modelId: model.id,
        provider: 'anthropic',
        async createTurn(args: CreateTurnArgs): Promise<AssistantTurn> {
            const c = await getClient();
            const body: MessageCreateParams = {
                model: model.modelName,
                max_tokens: args.maxTokens,
                temperature: args.temperature,
                system: mapSystem(args.system),
                tools: mapTools(args.tools),
                messages: args.messages.map(toAnthropicMessage),
            };

            let lastErr: unknown;
            for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
                try {
                    const res = await c.messages.create(body);
                    return {
                        text: extractText(res.content),
                        toolUses: extractToolUses(res.content),
                        usage: normalizeUsage(res.usage),
                        stopReason: res.stop_reason ?? 'end_turn',
                    };
                } catch (err) {
                    lastErr = err;
                    // Only retry 429/5xx/network; rethrow everything else (e.g. 400s) immediately.
                    if (attempt < MAX_RETRIES && isRetryable(err)) {
                        const ms = backoffMs(attempt, err);
                        const status = errStatus(err);
                        const label =
                            status === 429
                                ? 'rate-limited (429)'
                                : `transient error (${status ?? 'network'})`;
                        console.warn(
                            `[anthropic] ${label} — waiting ${(ms / 1000).toFixed(1)}s then continuing (attempt ${attempt + 1}/${MAX_RETRIES})`,
                        );
                        await sleep(ms);
                        continue;
                    }
                    throw err;
                }
            }
            throw lastErr;
        },
    };
}
