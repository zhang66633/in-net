// OpenAI Chat Completions API type definitions
// Based on: https://platform.openai.com/docs/api-reference/chat

// ── Messages ─────────────────────────────────────────────────────

export interface OpenAiMessage {
  role: "system" | "user" | "assistant" | "tool";
  content?: string | OpenAiContentPart[] | null;
  tool_calls?: OpenAiToolCall[];
  tool_call_id?: string; // when role === "tool"
  reasoning_content?: string; // DeepSeek non-standard extension
  reasoning?: string; // Kimi/Moonshot non-standard extension (same purpose)
}

export type OpenAiContentPart =
  | { type: "text"; text: string }
  | {
      type: "image_url";
      image_url: {
        url: string; // URL or "data:image/...;base64,..."
        detail?: "auto" | "low" | "high";
      };
    };

// ── Tools ────────────────────────────────────────────────────────

export interface OpenAiTool {
  type: "function";
  function: {
    name: string;
    description?: string;
    parameters: Record<string, unknown>; // JSON Schema
    strict?: boolean;
  };
}

export interface OpenAiToolCall {
  id: string;
  type: "function";
  function: {
    name: string;
    arguments: string; // JSON-encoded string
  };
}

export type OpenAiToolChoice =
  | "none"
  | "auto"
  | "required"
  | { type: "function"; function: { name: string } };

// ── Request ──────────────────────────────────────────────────────

export interface OpenAiChatRequest {
  model: string;
  messages: OpenAiMessage[];
  max_tokens?: number;
  max_completion_tokens?: number;
  temperature?: number;
  top_p?: number;
  stop?: string | string[];
  stream?: boolean;
  stream_options?: {
    include_usage?: boolean;
  };
  tools?: OpenAiTool[];
  tool_choice?: OpenAiToolChoice;
}

// ── Response (non-streaming) ─────────────────────────────────────

export interface OpenAiChatResponse {
  id: string;
  object: "chat.completion";
  created: number;
  model: string;
  choices: OpenAiChoice[];
  usage?: OpenAiUsage;
  system_fingerprint?: string;
}

export interface OpenAiChoice {
  index: number;
  message: OpenAiMessage;
  finish_reason: "stop" | "length" | "tool_calls" | "content_filter" | null;
  logprobs?: unknown;
}

export interface OpenAiUsage {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
}

// ── Streaming ────────────────────────────────────────────────────

export interface OpenAiStreamChunk {
  id: string;
  object: "chat.completion.chunk";
  created: number;
  model: string;
  choices: OpenAiStreamChoice[];
  usage?: OpenAiUsage;
}

export interface OpenAiStreamChoice {
  index: number;
  delta: OpenAiDelta;
  finish_reason: "stop" | "length" | "tool_calls" | "content_filter" | null;
  logprobs?: unknown;
}

export interface OpenAiDelta {
  role?: string;
  content?: string | null;
  tool_calls?: OpenAiStreamToolCallDelta[];
  reasoning_content?: string; // DeepSeek non-standard
  reasoning?: string; // Kimi/Moonshot non-standard
}

export interface OpenAiStreamToolCallDelta {
  index: number;
  id?: string;
  type?: "function";
  function?: {
    name?: string;
    arguments?: string;
  };
}

// ── Error ────────────────────────────────────────────────────────

export interface OpenAiErrorResponse {
  error: {
    message: string;
    type: string;
    code?: string;
    param?: string | null;
  };
}
