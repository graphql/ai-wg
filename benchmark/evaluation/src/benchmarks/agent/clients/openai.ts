/**
 * OpenAI ModelClient (§5.7) — the second provider behind the same seam as
 * AnthropicClient. Maps the normalized CreateTurnArgs to/from OpenAI's chat
 * completions wire format.
 *
 * Wire-format traps this client absorbs (§5.5):
 *   - An assistant `tool_use` becomes an assistant message with `tool_calls`;
 *     EACH `tool_result` must become its OWN `{ role:'tool', tool_call_id }`
 *     message — one per tool_call_id — or the next request 400s.
 *   - Usage: OpenAI `prompt_tokens` INCLUDES the cached subset, so we report
 *     inputTokens = prompt_tokens and cacheReadInputTokens =
 *     prompt_tokens_details.cached_tokens (cost.ts subtracts before billing).
 *     There is no cache-creation counter, so cacheCreationInputTokens = 0.
 *
 * SDK access mirrors embeddings.ts getOpenAIClient: dynamic import + a local
 * minimal interface + cast + env key, so we never take a static type dep on the
 * installed 'openai' package.
 */
import type { AgentModelDef } from '../../../core/types.ts';
import type {
    AssistantTurn,
    ChatMessage,
    CreateTurnArgs,
    ModelClient,
    ToolUse,
    Usage,
} from './types.ts';

// ─── Minimal local view of the OpenAI chat surface we use ────────────────────

interface OpenAIToolCall {
    id: string;
    type: 'function';
    function: { name: string; arguments: string };
}

interface OpenAIMessage {
    role: 'system' | 'user' | 'assistant' | 'tool';
    content?: string | null;
    tool_calls?: OpenAIToolCall[];
    tool_call_id?: string;
}

interface OpenAITool {
    type: 'function';
    function: { name: string; description: string; parameters: Record<string, unknown> };
}

interface ChatCompletionRequest {
    model: string;
    messages: OpenAIMessage[];
    tools?: OpenAITool[];
    tool_choice?: 'auto';
    max_completion_tokens?: number;
    max_tokens?: number;
    temperature?: number;
}

interface ChatCompletionResponse {
    choices: {
        message: { content?: string | null; tool_calls?: OpenAIToolCall[] };
        finish_reason?: string;
    }[];
    usage?: {
        prompt_tokens?: number;
        completion_tokens?: number;
        prompt_tokens_details?: { cached_tokens?: number };
    };
}

interface OpenAIClient {
    chat: {
        completions: { create: (req: ChatCompletionRequest) => Promise<ChatCompletionResponse> };
    };
}

let client: OpenAIClient | null = null;

async function getClient(): Promise<OpenAIClient> {
    if (client) return client;
    const apiKey = process.env['OPENAI_API_KEY'];
    if (!apiKey) {
        throw new Error('OPENAI_API_KEY is required to run the agent benchmark.');
    }
    const { default: OpenAI } = await import('openai');
    client = new OpenAI({ apiKey }) as unknown as OpenAIClient;
    return client;
}

// ─── Message mapping ─────────────────────────────────────────────────────────

/**
 * Map one normalized ChatMessage to 1+ OpenAI messages. An assistant message
 * with tool_use blocks collapses into a single assistant message carrying
 * `tool_calls`; a user message's tool_result blocks each become a SEPARATE
 * `{ role:'tool', tool_call_id, content }` message (§5.5 — required pairing).
 */
function toOpenAIMessages(msg: ChatMessage): OpenAIMessage[] {
    if (msg.role === 'assistant') {
        let text = '';
        const toolCalls: OpenAIToolCall[] = [];
        for (const block of msg.content) {
            if (block.type === 'text') {
                text += block.text;
            } else if (block.type === 'tool_use') {
                toolCalls.push({
                    id: block.id,
                    type: 'function',
                    function: { name: block.name, arguments: JSON.stringify(block.input) },
                });
            }
        }
        const out: OpenAIMessage = { role: 'assistant', content: text || null };
        if (toolCalls.length > 0) out.tool_calls = toolCalls;
        return [out];
    }

    // user role: text → user message; each tool_result → its own tool message.
    const out: OpenAIMessage[] = [];
    let text = '';
    for (const block of msg.content) {
        if (block.type === 'text') {
            text += block.text;
        } else if (block.type === 'tool_result') {
            out.push({ role: 'tool', tool_call_id: block.toolUseId, content: block.content });
        }
    }
    if (text) out.unshift({ role: 'user', content: text });
    return out;
}

// ─── Retry policy (mirrors anthropic.ts §5.6) ────────────────────────────────

const MAX_RETRIES = 8;
const MAX_BACKOFF_MS = 30_000;

/** Numeric HTTP status off a thrown SDK error, if present. */
function errorStatus(err: unknown): number | undefined {
    const status = (err as { status?: unknown } | null)?.status;
    return typeof status === 'number' ? status : undefined;
}

/** Retry 429 and 5xx (and status-less network errors); never retry 4xx like 400. */
function isRetryable(err: unknown): boolean {
    const status = errorStatus(err);
    if (status === undefined) return true; // network / transport error
    if (status === 429) return true;
    return status >= 500;
}

/** Honour the rate limit's suggested wait: the `retry-after`/`retry-after-ms`
 *  header, else the "Please try again in 2.3s" hint in the message. Returns ms. */
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

function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

async function withRetry<T>(fn: () => Promise<T>): Promise<T> {
    let lastErr: unknown;
    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
        try {
            return await fn();
        } catch (err) {
            lastErr = err;
            if (attempt === MAX_RETRIES - 1 || !isRetryable(err)) throw err;
            const expo = 1000 * 2 ** attempt; // 1s/2s/4s/8s/16s
            const hinted = retryAfterMs(err) ?? 0; // respect the limit's own wait
            const backoff =
                Math.min(MAX_BACKOFF_MS, Math.max(expo, hinted)) + Math.floor(Math.random() * 500);
            const status = errorStatus(err);
            const label =
                status === 429 ? 'rate-limited (429)' : `transient error (${status ?? 'network'})`;
            console.warn(
                `[openai] ${label} — waiting ${(backoff / 1000).toFixed(1)}s then continuing (attempt ${attempt + 1}/${MAX_RETRIES})`,
            );
            await sleep(backoff);
        }
    }
    throw lastErr;
}

// ─── Client factory ──────────────────────────────────────────────────────────

export function makeOpenAIClient(model: AgentModelDef): ModelClient {
    return {
        modelId: model.modelName,
        provider: 'openai',
        async createTurn(args: CreateTurnArgs): Promise<AssistantTurn> {
            const c = await getClient();

            const messages: OpenAIMessage[] = [{ role: 'system', content: args.system }];
            for (const msg of args.messages) {
                messages.push(...toOpenAIMessages(msg));
            }

            const tools: OpenAITool[] = args.tools.map((t) => ({
                type: 'function',
                function: { name: t.name, description: t.description, parameters: t.inputSchema },
            }));

            const res = await withRetry(() =>
                c.chat.completions.create({
                    model: model.modelName,
                    messages,
                    ...(tools.length > 0 ? { tools, tool_choice: 'auto' as const } : {}),
                    // Use ONLY max_completion_tokens — current models (gpt-4.1/4o/5,
                    // o-series) reject sending it alongside the legacy max_tokens.
                    max_completion_tokens: args.maxTokens,
                    // GPT-5 / o-series reasoning models reject a custom temperature
                    // (400 on temperature:0); omit it so they use their default.
                    ...(model.supportsTemperature === false
                        ? {}
                        : { temperature: args.temperature }),
                }),
            );

            const choice = res.choices[0];
            const message = choice?.message;
            const rawToolCalls = message?.tool_calls ?? [];
            const toolUses: ToolUse[] = rawToolCalls.map((tc) => ({
                id: tc.id,
                name: tc.function.name,
                input: JSON.parse(tc.function.arguments),
            }));

            // OpenAI: prompt_tokens INCLUDES the cached subset (cost.ts subtracts).
            const u = res.usage;
            const usage: Usage = {
                inputTokens: u?.prompt_tokens ?? 0,
                outputTokens: u?.completion_tokens ?? 0,
                cacheCreationInputTokens: 0,
                cacheReadInputTokens: u?.prompt_tokens_details?.cached_tokens ?? 0,
            };

            return {
                text: message?.content ?? '',
                toolUses,
                usage,
                stopReason: choice?.finish_reason ?? 'stop',
            };
        },
    };
}
