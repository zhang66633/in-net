// Anthropic Messages API type definitions
// Based on: https://docs.anthropic.com/en/api/messages

// ── Content Blocks ──────────────────────────────────────────────

export interface AnthropicTextContentBlock {
  type: "text";
  text: string;
  cache_control?: { type: "ephemeral" } | null;
}

export interface AnthropicImageContentBlock {
  type: "image";
  source: {
    type: "base64";
    media_type: string; // e.g. "image/jpeg", "image/png"
    data: string; // base64-encoded
  };
  cache_control?: { type: "ephemeral" } | null;
}

export interface AnthropicToolUseContentBlock {
  type: "tool_use";
  id: string;
  name: string;
  input: Record<string, unknown>;
  cache_control?: { type: "ephemeral" } | null;
}

export interface AnthropicToolResultContentBlock {
  type: "tool_result";
  tool_use_id: string;
  content: string | AnthropicTextContentBlock[];
  is_error?: boolean;
  cache_control?: { type: "ephemeral" } | null;
}

export interface AnthropicDocumentContentBlock {
  type: "document";
  source: {
    type: "content" | "url" | "base64";
    media_type?: string;
    data?: string;
    content?: string;
    url?: string;
  };
  title?: string;
  context?: string;
  citations?: { enabled: boolean };
  cache_control?: { type: "ephemeral" } | null;
}

export interface AnthropicThinkingContentBlock {
  type: "thinking";
  thinking: string;
  signature: string;
}

export interface AnthropicRedactedThinkingContentBlock {
  type: "redacted_thinking";
  data: string;
}

export type AnthropicContentBlock =
  | AnthropicTextContentBlock
  | AnthropicImageContentBlock
  | AnthropicToolUseContentBlock
  | AnthropicToolResultContentBlock
  | AnthropicDocumentContentBlock
  | AnthropicThinkingContentBlock
  | AnthropicRedactedThinkingContentBlock;

// ── Messages ─────────────────────────────────────────────────────

export interface AnthropicMessage {
  role: "user" | "assistant";
  content: string | AnthropicContentBlock[];
}

// ── Tools ────────────────────────────────────────────────────────

export interface AnthropicTool {
  name: string;
  description?: string;
  input_schema: Record<string, unknown>; // JSON Schema
  cache_control?: { type: "ephemeral" } | null;
}

export type AnthropicToolChoice =
  | { type: "auto" }
  | { type: "any" }
  | { type: "tool"; name: string };

// ── Request ──────────────────────────────────────────────────────

export interface AnthropicMessageRequest {
  model: string;
  messages: AnthropicMessage[];
  system?: string | AnthropicTextContentBlock[];
  max_tokens: number;
  metadata?: Record<string, unknown>;
  stop_sequences?: string[];
  stream?: boolean;
  temperature?: number;
  top_p?: number;
  top_k?: number; // Anthropic-only, dropped in translation
  tools?: AnthropicTool[];
  tool_choice?: AnthropicToolChoice;
  thinking?: unknown; // Anthropic-only, dropped in translation
}

// ── Response ─────────────────────────────────────────────────────

export interface AnthropicMessageResponse {
  id: string;
  type: "message";
  role: "assistant";
  model: string;
  content: AnthropicContentBlock[];
  stop_reason: "end_turn" | "max_tokens" | "tool_use" | "stop_sequence" | null;
  stop_sequence: string | null;
  usage: AnthropicUsage;
}

export interface AnthropicUsage {
  input_tokens: number;
  output_tokens: number;
  cache_creation_input_tokens?: number | null;
  cache_read_input_tokens?: number | null;
}

export interface AnthropicErrorResponse {
  type: "error";
  error: {
    type: string;
    message: string;
  };
}

// ── Streaming Events ─────────────────────────────────────────────

export type AnthropicStreamEventType =
  | "message_start"
  | "content_block_start"
  | "content_block_delta"
  | "content_block_stop"
  | "message_delta"
  | "message_stop"
  | "ping";

export interface AnthropicMessageStartEvent {
  type: "message_start";
  message: {
    id: string;
    type: "message";
    role: "assistant";
    model: string;
    content: [];
    stop_reason: null;
    stop_sequence: null;
    usage: AnthropicUsage;
  };
}

export interface AnthropicContentBlockStartEvent {
  type: "content_block_start";
  index: number;
  content_block:
    | { type: "text"; text: "" }
    | { type: "tool_use"; id: string; name: string; input: {} };
}

export interface AnthropicContentBlockDeltaEvent {
  type: "content_block_delta";
  index: number;
  delta:
    | { type: "text_delta"; text: string }
    | { type: "input_json_delta"; partial_json: string };
}

export interface AnthropicContentBlockStopEvent {
  type: "content_block_stop";
  index: number;
}

export interface AnthropicMessageDeltaEvent {
  type: "message_delta";
  delta: {
    stop_reason: AnthropicMessageResponse["stop_reason"];
    stop_sequence: string | null;
  };
  usage: {
    output_tokens: number;
  };
}

export interface AnthropicMessageStopEvent {
  type: "message_stop";
}

export interface AnthropicPingEvent {
  type: "ping";
}

export type AnthropicStreamEvent =
  | AnthropicMessageStartEvent
  | AnthropicContentBlockStartEvent
  | AnthropicContentBlockDeltaEvent
  | AnthropicContentBlockStopEvent
  | AnthropicMessageDeltaEvent
  | AnthropicMessageStopEvent
  | AnthropicPingEvent;
