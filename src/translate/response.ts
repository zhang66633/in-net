import type {
  AnthropicMessageResponse,
  AnthropicContentBlock,
  AnthropicTextContentBlock,
  AnthropicToolUseContentBlock,
  AnthropicErrorResponse,
} from "../types/anthropic.js";
import type {
  OpenAiChatResponse,
  OpenAiErrorResponse,
} from "../types/openai.js";

/**
 * Translate an OpenAI Chat Completions response to an Anthropic Messages response.
 */
export function openaiToAnthropic(
  resp: OpenAiChatResponse,
  model: string
): AnthropicMessageResponse {
  const choice = resp.choices[0];
  if (!choice) {
    return createEmptyResponse(resp.id, model);
  }

  const content: AnthropicContentBlock[] = [];
  const msg = choice.message;

  // Text content → text block
  // Handle standard `content`, DeepSeek `reasoning_content`, and Kimi `reasoning`
  const text = extractTextContent(msg.content)
    || (msg.reasoning ? msg.reasoning : "")
    || (msg.reasoning_content ? msg.reasoning_content : "");
  if (text) {
    const textBlock: AnthropicTextContentBlock = {
      type: "text",
      text,
    };
    content.push(textBlock);
  }

  // Tool calls → tool_use blocks
  if (msg.tool_calls) {
    for (const tc of msg.tool_calls) {
      let input: Record<string, unknown> = {};
      try {
        input = JSON.parse(tc.function.arguments);
      } catch {
        // If arguments can't be parsed, wrap them
        input = { _raw_arguments: tc.function.arguments };
      }
      const toolUseBlock: AnthropicToolUseContentBlock = {
        type: "tool_use",
        id: tc.id,
        name: tc.function.name,
        input,
      };
      content.push(toolUseBlock);
    }
  }

  const stopReason = mapFinishReason(choice.finish_reason);

  return {
    id: resp.id,
    type: "message",
    role: "assistant",
    model: resp.model || model,
    content,
    stop_reason: stopReason,
    stop_sequence: null,
    usage: mapUsage(resp.usage),
  };
}

/**
 * Map OpenAI error response to Anthropic error format.
 */
export function openAiErrorToAnthropic(
  openAiError: OpenAiErrorResponse,
  statusCode: number
): AnthropicErrorResponse {
  const typeMap: Record<string, string> = {
    invalid_request_error: "invalid_request_error",
    authentication_error: "authentication_error",
    permission_error: "permission_error",
    not_found_error: "not_found_error",
    rate_limit_error: "rate_limit_error",
  };

  return {
    type: "error",
    error: {
      type: typeMap[openAiError.error.type] || "api_error",
      message: openAiError.error.message,
    },
  };
}

// ── Helpers ──────────────────────────────────────────────────────

function extractTextContent(
  content?: string | { type: string; text?: string }[] | null
): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .filter((p) => p.type === "text")
      .map((p) => p.text ?? "")
      .join("");
  }
  return "";
}

function createEmptyResponse(
  id: string,
  model: string
): AnthropicMessageResponse {
  return {
    id,
    type: "message",
    role: "assistant",
    model,
    content: [],
    stop_reason: null,
    stop_sequence: null,
    usage: { input_tokens: 0, output_tokens: 0 },
  };
}

export function mapFinishReason(
  reason: string | null
): AnthropicMessageResponse["stop_reason"] {
  switch (reason) {
    case "stop":
      return "end_turn";
    case "length":
      return "max_tokens";
    case "tool_calls":
      return "tool_use";
    case "content_filter":
      return "end_turn"; // best approximation
    default:
      return null;
  }
}

export function mapUsage(usage?: {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
}): { input_tokens: number; output_tokens: number } {
  return {
    input_tokens: usage?.prompt_tokens ?? 0,
    output_tokens: usage?.completion_tokens ?? 0,
  };
}
