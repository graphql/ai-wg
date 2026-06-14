/**
 * Provider-agnostic chat-client contract for the agent benchmark.
 *
 * The AgentSession (session.ts) speaks only this interface; AnthropicClient and
 * OpenAIClient map it to/from each provider's wire format (tool-use, prompt
 * caching, usage). Messages use a small normalized content-block model so the
 * same conversation drives either provider.
 */

/** A tool the model may call (mapped per provider). */
export interface ToolDef {
    name: string;
    description: string;
    inputSchema: Record<string, unknown>; // JSON Schema
}

/** A normalized assistant tool-use request (one per tool the model invoked). */
export interface ToolUse {
    id: string; // tool_use_id (Anthropic) / tool_call.id (OpenAI)
    name: string; // 'search' | 'execute'
    input: unknown; // parsed JSON object (OpenAI arguments are JSON-stringified — the client parses)
}

/** Per-turn token usage, provider-mapped. Anthropic exposes cache create/read
 *  directly; OpenAI maps cached prompt tokens → cacheReadInputTokens and
 *  reports 0 for cacheCreation (automatic caching, no write). */
export interface Usage {
    inputTokens: number;
    outputTokens: number;
    cacheCreationInputTokens: number;
    cacheReadInputTokens: number;
}

/** Normalized message content blocks. */
export type ContentBlock =
    | { type: 'text'; text: string }
    | { type: 'tool_use'; id: string; name: string; input: unknown }
    | { type: 'tool_result'; toolUseId: string; content: string; isError?: boolean };

export interface ChatMessage {
    role: 'user' | 'assistant';
    content: ContentBlock[];
}

/** What one model round-trip returns. */
export interface AssistantTurn {
    text: string; // any assistant prose (may be empty)
    toolUses: ToolUse[]; // 0+ tool_use blocks
    usage: Usage;
    stopReason: string; // provider stop reason, normalized loosely ('tool_use'|'end_turn'|'max_tokens'|...)
}

export interface CreateTurnArgs {
    system: string; // cached on Anthropic; a system message on OpenAI
    tools: ToolDef[]; // cached on Anthropic
    messages: ChatMessage[]; // the running conversation
    maxTokens: number;
    temperature: number;
}

/** The seam both providers implement. One instance per session. */
export interface ModelClient {
    readonly modelId: string;
    readonly provider: 'anthropic' | 'openai';
    createTurn(args: CreateTurnArgs): Promise<AssistantTurn>;
}
