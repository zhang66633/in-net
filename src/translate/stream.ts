import { randomUUID } from "node:crypto";
import type {
  AnthropicStreamEventType,
  AnthropicStreamEvent,
} from "../types/anthropic.js";
import type {
  OpenAiStreamChunk,
  OpenAiStreamToolCallDelta,
} from "../types/openai.js";
import { mapFinishReason } from "./response.js";

// ── Stream state ────────────────────────────────────────────────

interface ToolCallState {
  id: string;
  name: string;
  partialJson: string;
  anthropicIndex: number;
  hasStarted: boolean;
}

interface StreamState {
  messageId: string;
  model: string;
  contentBlockIndex: number;
  currentBlockType: "text" | "tool_use" | null;
  textContent: string;
  toolCallStates: Map<number, ToolCallState>;
  hasStarted: boolean;
  inputTokens: number;
  outputTokens: number;
  finished: boolean;
}

interface EmitterOptions {
  onEvent: (eventType: AnthropicStreamEventType, data: AnthropicStreamEvent) => Promise<void>;
  model: string;
}

// ── Emitter Class ───────────────────────────────────────────────

export class AnthropicStreamEmitter {
  private state: StreamState;
  private onEvent: EmitterOptions["onEvent"];
  /** Whether the stream has been finished (message_stop emitted). */
  public isFinished: boolean;

  constructor(opts: EmitterOptions) {
    this.onEvent = opts.onEvent;
    this.isFinished = false;
    this.state = {
      messageId: "msg_" + randomUUID(),
      model: opts.model,
      contentBlockIndex: -1,
      currentBlockType: null,
      textContent: "",
      toolCallStates: new Map(),
      hasStarted: false,
      inputTokens: 0,
      outputTokens: 0,
      finished: false,
    };
  }

  /**
   * Process a single OpenAI stream chunk and emit corresponding Anthropic SSE events.
   */
  async processChunk(chunk: OpenAiStreamChunk): Promise<void> {
    if (this.state.finished) return;

    const choice = chunk.choices?.[0];
    if (!choice) return;

    const delta = choice.delta;
    const finishReason = choice.finish_reason;

    // ── First chunk: emit message_start ────────────────────────
    if (!this.state.hasStarted) {
      this.state.model = chunk.model || this.state.model;
      if (chunk.usage) {
        this.state.inputTokens = chunk.usage.prompt_tokens;
      }
      await this.emitMessageStart();
      this.state.hasStarted = true;
    }

    // ── Text content delta ─────────────────────────────────────
    // Kimi puts output in `reasoning` / `reasoning_content` delta fields
    const textDelta = delta.content
      || (delta.reasoning ? delta.reasoning : "")
      || (delta.reasoning_content ? delta.reasoning_content : "");
    if (textDelta) {
      await this.handleTextDelta(textDelta);
    }

    // ── Tool call delta ────────────────────────────────────────
    if (delta.tool_calls && delta.tool_calls.length > 0) {
      for (const tc of delta.tool_calls) {
        await this.handleToolCallDelta(tc);
      }
    }

    // ── Finish reason: emit final events ───────────────────────
    if (finishReason !== null && finishReason !== undefined && !this.state.finished) {
      // Capture usage if present in the final chunk
      if (chunk.usage) {
        this.state.inputTokens = chunk.usage.prompt_tokens;
        this.state.outputTokens = chunk.usage.completion_tokens;
      }
      await this.emitFinish(finishReason);
    }
  }

  /**
   * Force-finish the stream (called when the upstream stream ends without a finish_reason).
   */
  async finish(): Promise<void> {
    if (this.state.finished) return;

    // If no events were emitted at all, emit minimal lifecycle
    if (!this.state.hasStarted) {
      await this.emitMessageStart();
      this.state.hasStarted = true;
    }

    await this.closeCurrentBlock();
    await this.onEvent("message_delta", {
      type: "message_delta",
      delta: {
        stop_reason: "end_turn",
        stop_sequence: null,
      },
      usage: {
        output_tokens: this.state.outputTokens,
      },
    });
    await this.onEvent("message_stop", { type: "message_stop" });
    this.state.finished = true;
    this.isFinished = true;
  }

  // ── Private helpers ───────────────────────────────────────────

  private async emitMessageStart(): Promise<void> {
    await this.onEvent("message_start", {
      type: "message_start",
      message: {
        id: this.state.messageId,
        type: "message",
        role: "assistant",
        model: this.state.model,
        content: [],
        stop_reason: null,
        stop_sequence: null,
        usage: {
          input_tokens: this.state.inputTokens,
          output_tokens: 0,
        },
      },
    });
  }

  private async handleTextDelta(text: string): Promise<void> {
    // If currently in a tool_use block, close it first
    if (this.state.currentBlockType === "tool_use") {
      await this.emitContentBlockStop();
    }

    // Open a text block if not already in one
    if (this.state.currentBlockType !== "text") {
      this.state.contentBlockIndex++;
      await this.onEvent("content_block_start", {
        type: "content_block_start",
        index: this.state.contentBlockIndex,
        content_block: { type: "text", text: "" },
      });
      this.state.currentBlockType = "text";
    }

    // Emit text delta
    this.state.textContent += text;
    await this.onEvent("content_block_delta", {
      type: "content_block_delta",
      index: this.state.contentBlockIndex,
      delta: { type: "text_delta", text },
    });
  }

  private async handleToolCallDelta(tc: OpenAiStreamToolCallDelta): Promise<void> {
    let tcState = this.state.toolCallStates.get(tc.index);

    // First time seeing this tool call index
    if (!tcState) {
      // Close current text block if open
      if (this.state.currentBlockType === "text") {
        await this.emitContentBlockStop();
      }

      this.state.contentBlockIndex++;
      const id = tc.id || "toolu_" + randomUUID();
      const name = tc.function?.name || "";

      tcState = {
        id,
        name,
        partialJson: "",
        anthropicIndex: this.state.contentBlockIndex,
        hasStarted: true,
      };
      this.state.toolCallStates.set(tc.index, tcState);

      // Emit content_block_start for tool_use
      await this.onEvent("content_block_start", {
        type: "content_block_start",
        index: tcState.anthropicIndex,
        content_block: {
          type: "tool_use",
          id: tcState.id,
          name: tcState.name,
          input: {},
        },
      });
      this.state.currentBlockType = "tool_use";
    } else if (this.state.currentBlockType !== "tool_use") {
      // We were in text but a new tool call delta arrived for an existing index
      // Switch to the correct tool block — emit stop for text if needed
      if (this.state.currentBlockType === "text") {
        await this.emitContentBlockStop();
      }
      this.state.currentBlockType = "tool_use";
    }

    // Append argument fragments
    if (tc.function?.arguments) {
      tcState.partialJson += tc.function.arguments;
      await this.onEvent("content_block_delta", {
        type: "content_block_delta",
        index: tcState.anthropicIndex,
        delta: {
          type: "input_json_delta",
          partial_json: tc.function.arguments,
        },
      });
    }
  }

  private async emitFinish(finishReason: string): Promise<void> {
    // Close the currently open content block
    await this.closeCurrentBlock();

    const stopReason = mapFinishReason(finishReason);

    await this.onEvent("message_delta", {
      type: "message_delta",
      delta: {
        stop_reason: stopReason,
        stop_sequence: null,
      },
      usage: {
        output_tokens: this.state.outputTokens,
      },
    });

    await this.onEvent("message_stop", { type: "message_stop" });
    this.state.finished = true;
    this.isFinished = true;
  }

  private async closeCurrentBlock(): Promise<void> {
    if (this.state.currentBlockType !== null && this.state.contentBlockIndex >= 0) {
      await this.onEvent("content_block_stop", {
        type: "content_block_stop",
        index: this.state.contentBlockIndex,
      });
    }
  }

  private async emitContentBlockStop(): Promise<void> {
    if (this.state.contentBlockIndex >= 0) {
      await this.onEvent("content_block_stop", {
        type: "content_block_stop",
        index: this.state.contentBlockIndex,
      });
    }
  }
}
