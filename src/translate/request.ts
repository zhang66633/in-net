import type {
  AnthropicMessageRequest,
  AnthropicMessage,
  AnthropicContentBlock,
  AnthropicTextContentBlock,
  AnthropicImageContentBlock,
  AnthropicDocumentContentBlock,
  AnthropicToolUseContentBlock,
  AnthropicToolResultContentBlock,
  AnthropicTool,
  AnthropicToolChoice,
} from "../types/anthropic.js";
import type {
  OpenAiChatRequest,
  OpenAiMessage,
  OpenAiContentPart,
  OpenAiTool,
  OpenAiToolChoice,
  OpenAiToolCall,
} from "../types/openai.js";

/**
 * Translate an Anthropic Messages API request to an OpenAI Chat Completions request.
 */
export function anthropicToOpenAI(
  req: AnthropicMessageRequest
): OpenAiChatRequest {
  const messages: OpenAiMessage[] = [];

  // 1. System prompt: Anthropic top-level "system" → OpenAI role:"system" message
  if (req.system) {
    if (typeof req.system === "string") {
      messages.push({ role: "system", content: req.system });
    } else if (Array.isArray(req.system)) {
      const systemText = req.system
        .map((b) => (b.type === "text" ? b.text : ""))
        .filter(Boolean)
        .join("\n");
      if (systemText) {
        messages.push({ role: "system", content: systemText });
      }
    }
  }

  // 2. Messages with content blocks
  for (const msg of req.messages) {
    const converted = convertMessage(msg);
    if (Array.isArray(converted)) {
      messages.push(...converted);
    } else {
      messages.push(converted);
    }
  }

  // 3. Tools
  let tools: OpenAiTool[] | undefined;
  if (req.tools && req.tools.length > 0) {
    tools = req.tools.map(convertTool);
  }

  // 4. Tool choice
  let tool_choice: OpenAiToolChoice | undefined;
  if (req.tool_choice) {
    tool_choice = convertToolChoice(req.tool_choice);
  }

  // 5. Stop sequences
  let stop: string | string[] | undefined;
  if (req.stop_sequences && req.stop_sequences.length > 0) {
    stop = req.stop_sequences.length === 1 ? req.stop_sequences[0] : req.stop_sequences;
  }

  // 6. Build the OpenAI request
  // Drop Anthropic-only fields: top_k, thinking, cache_control
  const result: OpenAiChatRequest = {
    model: req.model,
    messages,
    max_tokens: req.max_tokens,
    stream: req.stream,
    temperature: req.temperature,
    top_p: req.top_p,
    stop,
    tools,
    tool_choice,
  };

  return result;
}

// ── Message Conversion ──────────────────────────────────────────

function convertMessage(
  msg: AnthropicMessage
): OpenAiMessage | OpenAiMessage[] {
  // Normalize content: string → [{type: "text", text: string}]
  const blocks: AnthropicContentBlock[] = typeof msg.content === "string"
    ? [{ type: "text", text: msg.content }]
    : msg.content;

  // Tool result blocks → multiple "tool" role messages
  const toolResults = blocks.filter(
    (b): b is AnthropicToolResultContentBlock => b.type === "tool_result"
  );
  const nonToolBlocks = blocks.filter((b) => b.type !== "tool_result");

  if (toolResults.length > 0 && nonToolBlocks.length === 0) {
    // Pure tool results: return as tool messages
    return toolResults.map((tr) => ({
      role: "tool" as const,
      tool_call_id: tr.tool_use_id,
      content: typeof tr.content === "string" ? tr.content : tr.content.map(b => b.text).join(""),
    }));
  }

  // Normal message (user or assistant) with optional tool calls
  const { content, toolCalls } = convertContentBlocks(nonToolBlocks);

  return {
    role: msg.role as "user" | "assistant",
    content: content ?? "",
    ...(toolCalls && toolCalls.length > 0 ? { tool_calls: toolCalls } : {}),
  };
}

// ── Content Block Conversion ────────────────────────────────────

function convertContentBlocks(blocks: AnthropicContentBlock[]): {
  content: string | OpenAiContentPart[] | null;
  toolCalls: OpenAiToolCall[];
} {
  const textBlocks = blocks.filter(
    (b): b is AnthropicTextContentBlock => b.type === "text"
  );
  const imageBlocks = blocks.filter(
    (b): b is AnthropicImageContentBlock => b.type === "image"
  );
  const documentBlocks = blocks.filter(
    (b): b is AnthropicDocumentContentBlock => b.type === "document"
  );
  const toolUseBlocks = blocks.filter(
    (b): b is AnthropicToolUseContentBlock => b.type === "tool_use"
  );

  const toolCalls: OpenAiToolCall[] = toolUseBlocks.map((tu) => ({
    id: tu.id,
    type: "function" as const,
    function: {
      name: tu.name,
      arguments: JSON.stringify(tu.input),
    },
  }));

  // Convert document blocks to text (Kimi doesn't support document type)
  const docTexts = documentBlocks.map(convertDocumentBlock);

  // If only text/docs and no images, return a plain string
  if (imageBlocks.length === 0) {
    const text = [...textBlocks.map((b) => b.text), ...docTexts].join("\n");
    return { content: text || null, toolCalls };
  }

  // Text + images + docs → multimodal array
  const parts: OpenAiContentPart[] = [
    ...textBlocks.map((b) => ({ type: "text" as const, text: b.text })),
    ...docTexts.map((t) => ({ type: "text" as const, text: t })),
    ...imageBlocks.map((b) => ({
      type: "image_url" as const,
      image_url: {
        url: `data:${b.source.media_type};base64,${b.source.data}`,
      },
    })),
  ];

  return { content: parts.length > 0 ? parts : null, toolCalls };
}

/** Convert an Anthropic document block to plain text for OpenAI compatibility. */
function convertDocumentBlock(doc: AnthropicDocumentContentBlock): string {
  const parts: string[] = [];
  if (doc.title) parts.push(`[文件: ${doc.title}]`);
  if (doc.context) parts.push(`(${doc.context})`);

  const src = doc.source;
  if (src.type === "content" && src.content) {
    parts.push(src.content);
  } else if (src.type === "url" && src.url) {
    parts.push(`[文档链接: ${src.url}]`);
  } else if (src.type === "base64" && src.data) {
    // Base64 encoded content — decode if it's text
    try {
      const decoded = Buffer.from(src.data, "base64").toString("utf-8");
      parts.push(decoded);
    } catch {
      parts.push(`[二进制文档: ${src.media_type || "unknown"}]`);
    }
  }

  return parts.join("\n");
}

// ── Tool Conversion ─────────────────────────────────────────────

function convertTool(at: AnthropicTool): OpenAiTool {
  return {
    type: "function",
    function: {
      name: at.name,
      description: at.description,
      parameters: at.input_schema,
    },
  };
}

function convertToolChoice(tc: AnthropicToolChoice): OpenAiToolChoice {
  switch (tc.type) {
    case "auto":
      return "auto";
    case "any":
      return "required";
    case "tool":
      return { type: "function", function: { name: tc.name } };
  }
}
