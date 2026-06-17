import { Hono } from "hono";
import type { Context } from "hono";
import { streamSSE } from "hono/streaming";
import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import type { Config } from "./config.js";
import type { AnthropicMessageRequest } from "./types/anthropic.js";
import type { OpenAiChatResponse, OpenAiErrorResponse } from "./types/openai.js";
import type { LogEntry } from "./types/management.js";
import { anthropicToOpenAI } from "./translate/request.js";
import { openaiToAnthropic, openAiErrorToAnthropic } from "./translate/response.js";
import { AnthropicStreamEmitter } from "./translate/stream.js";
import { proxyToUpstream } from "./proxy.js";
import { logger } from "./logger.js";
import type { RuntimeConfig } from "./runtime-config.js";
import type { LogStore } from "./store/logs.js";
import type { KeyStore } from "./store/keys.js";
import type { UpstreamStore } from "./store/upstreams.js";
import { createAuthRoutes, authMiddleware } from "./routes/auth.js";
import { createKeyRoutes } from "./routes/api-keys.js";
import { createUpstreamRoutes } from "./routes/upstreams.js";
import { createManagementModelsRoutes } from "./routes/management-models.js";
import { createLogRoutes } from "./routes/logs.js";
import { createStatsRoutes } from "./routes/stats.js";
import { createRuntimeConfigRoutes } from "./routes/runtime-config-routes.js";

export function createApp(
  config: Config,
  runtimeConfig: RuntimeConfig,
  keyStore: KeyStore,
  upstreamStore: UpstreamStore,
  _logStore: LogStore
): Hono {
  const app = new Hono();

  // ── Auth routes (no middleware needed for login/logout/status) ─
  app.route("/", createAuthRoutes(runtimeConfig));

  // ── Auth middleware for /api/* ─────────────────────────────────
  app.use("/api/*", async (c, next) => {
    await authMiddleware(c, next, runtimeConfig);
  });

  // ── Management API routes ─────────────────────────────────────
  app.route("/", createKeyRoutes(keyStore));
  app.route("/", createUpstreamRoutes(upstreamStore, config, runtimeConfig));
  app.route("/", createManagementModelsRoutes(config, runtimeConfig, keyStore, upstreamStore));
  app.route("/", createLogRoutes(_logStore));
  app.route("/", createStatsRoutes(_logStore));
  app.route("/", createRuntimeConfigRoutes(runtimeConfig));

  // ── Admin panel (served as raw HTML) ─────────────────────────
  app.get("/admin", async (c) => {
    try {
      const html = await readFile("src/frontend/admin.html", "utf-8");
      return c.html(html);
    } catch {
      return c.text("Admin panel not found", 404);
    }
  });
  app.get("/admin/", async (c) => {
    try {
      const html = await readFile("src/frontend/admin.html", "utf-8");
      return c.html(html);
    } catch {
      return c.text("Admin panel not found", 404);
    }
  });

  // ── Health check ──────────────────────────────────────────────
  app.get("/health", (c) => {
    return c.json({ status: "ok", upstream: config.upstream });
  });

  // ── Models passthrough ────────────────────────────────────────
  app.get("/v1/models", async (c) => {
    // Resolve key: x-api-key header > upstream-bound key > global active key > CLI default
    let apiKey = c.req.header("x-api-key") || undefined;
    if (!apiKey) {
      const up = await runtimeConfig.getActiveUpstream();
      if (up) apiKey = await resolveUpstreamKey(up.id, keyStore, upstreamStore, runtimeConfig) || undefined;
    }
    if (!apiKey) apiKey = config.defaultApiKey || "";
    if (!apiKey) {
      return c.json({ type: "error", error: { type: "authentication_error", message: "Missing API key" } }, 401);
    }

    const upstream = await runtimeConfig.getActiveUpstream();
    const baseUrl = (upstream?.url || config.upstream).replace(/\/chat\/completions\/?$/, "");

    try {
      const resp = await fetch(`${baseUrl}/models`, {
        headers: { Authorization: `Bearer ${apiKey}` },
        signal: c.req.raw.signal,
      });
      const body = await resp.text();
      return new Response(body, { status: resp.status, headers: { "Content-Type": "application/json" } });
    } catch (err) {
      const error = err as Error;
      if (error.name === "AbortError") return new Response(null, { status: 499 });
      return c.json({ type: "error", error: { type: "api_error", message: error.message } }, 502);
    }
  });

  // ── Main proxy endpoint ───────────────────────────────────────
  app.post("/v1/messages", async (c) => {
    // Resolve upstream URL (runtime > CLI)
    const upstream = await runtimeConfig.getActiveUpstream();
    const upstreamUrl = upstream?.url || config.upstream;

    // Resolve API key: x-api-key header > upstream-bound key > global active key > CLI default
    let apiKey = c.req.header("x-api-key") || undefined;
    let activeKey: { id: string; plaintext: string } | null = null;
    if (!apiKey && upstream) {
      apiKey = await resolveUpstreamKey(upstream.id, keyStore, upstreamStore, runtimeConfig) || undefined;
    }
    if (!apiKey) {
      activeKey = await runtimeConfig.getActiveKey();
      apiKey = activeKey?.plaintext || config.defaultApiKey || "";
    }
    if (!apiKey) {
      return c.json({ type: "error", error: { type: "authentication_error", message: "Missing x-api-key header" } }, 401);
    }

    let anthropicReq: AnthropicMessageRequest;
    try {
      anthropicReq = await c.req.json<AnthropicMessageRequest>();
    } catch {
      return c.json({ type: "error", error: { type: "invalid_request_error", message: "Invalid JSON" } }, 400);
    }

    if (!anthropicReq.model) {
      return c.json({ type: "error", error: { type: "invalid_request_error", message: "Missing required field: model" } }, 400);
    }
    if (!anthropicReq.max_tokens) anthropicReq.max_tokens = 4096;
    if (!anthropicReq.messages || anthropicReq.messages.length === 0) {
      return c.json({ type: "error", error: { type: "invalid_request_error", message: "Missing required field: messages" } }, 400);
    }

    const openAiReq = anthropicToOpenAI(anthropicReq);

    logger.debug("Request", {
      model: openAiReq.model,
      stream: !!openAiReq.stream,
      upstream: upstreamUrl,
    });

    // Request logging preamble
    const requestId = "req_" + randomUUID().slice(0, 12);
    const startTime = Date.now();
    let logStatus: LogEntry["status"] = "success";
    let logStatusCode = 200;
    let logError = "";
    let logRetries = 0;
    let logInputTokens = 0;
    let logOutputTokens = 0;

    // Forward to upstream
    let upstreamResp: Response;
    try {
      upstreamResp = await proxyToUpstream(openAiReq, upstreamUrl, apiKey, c.req.raw.signal, config.retry);
      logStatusCode = upstreamResp.status;
    } catch (err) {
      const error = err as Error;
      if (error.name === "AbortError") return new Response(null, { status: 499 });
      logStatus = "error";
      logStatusCode = 502;
      logError = error.message;

      // Fire-and-forget log
      _logStore.append({
        id: requestId, ts: new Date().toISOString(),
        model: anthropicReq.model, stream: !!anthropicReq.stream,
        inputTokens: 0, outputTokens: 0, latencyMs: Date.now() - startTime,
        status: logStatus, statusCode: logStatusCode,
        upstreamId: upstream?.id ?? "", keyId: activeKey?.id ?? "",
        error: logError, retries: logRetries,
      }).catch(() => {});

      return c.json({ type: "error", error: { type: "api_error", message: `Upstream error: ${error.message}` } }, 502);
    }

    // Handle upstream errors
    if (!upstreamResp.ok) {
      let errorBody: OpenAiErrorResponse;
      try { errorBody = await upstreamResp.json(); } catch {
        errorBody = { error: { message: `Upstream returned ${upstreamResp.status}`, type: "api_error" } };
      }
      const anthropicError = openAiErrorToAnthropic(errorBody, upstreamResp.status);

      logStatus = "error";
      logError = anthropicError.error.message;
      logStatusCode = upstreamResp.status;

      _logStore.append({
        id: requestId, ts: new Date().toISOString(),
        model: anthropicReq.model, stream: !!anthropicReq.stream,
        inputTokens: 0, outputTokens: 0, latencyMs: Date.now() - startTime,
        status: logStatus, statusCode: logStatusCode,
        upstreamId: upstream?.id ?? "", keyId: activeKey?.id ?? "",
        error: logError, retries: logRetries,
      }).catch(() => {});

      return new Response(JSON.stringify(anthropicError), {
        status: upstreamResp.status,
        headers: { "Content-Type": "application/json" },
      });
    }

    // ── Streaming path ──────────────────────────────────────────
    if (anthropicReq.stream) {
      return handleStreaming(c, upstreamResp, anthropicReq.model, _logStore, {
        requestId, startTime, model: anthropicReq.model,
        upstreamId: upstream?.id ?? "", keyId: activeKey?.id ?? "",
      });
    }

    // ── Non-streaming path ──────────────────────────────────────
    const openAiResp: OpenAiChatResponse = await upstreamResp.json();
    const anthropicResp = openaiToAnthropic(openAiResp, anthropicReq.model);

    logInputTokens = anthropicResp.usage.input_tokens;
    logOutputTokens = anthropicResp.usage.output_tokens;

    _logStore.append({
      id: requestId, ts: new Date().toISOString(),
      model: anthropicReq.model, stream: false,
      inputTokens: logInputTokens, outputTokens: logOutputTokens,
      latencyMs: Date.now() - startTime,
      status: "success", statusCode: 200,
      upstreamId: upstream?.id ?? "", keyId: activeKey?.id ?? "",
      error: "", retries: logRetries,
    }).catch(() => {});

    return c.json(anthropicResp);
  });

  // ── 404 catch-all ────────────────────────────────────────────
  app.all("*", (c) => {
    return c.json({ type: "error", error: { type: "not_found_error", message: `Not found: ${c.req.method} ${c.req.path}` } }, 404);
  });

  // ── Error handling ────────────────────────────────────────────
  app.onError((err, c) => {
    logger.error("Unhandled error", err);
    return c.json({ type: "error", error: { type: "api_error", message: err.message || "Internal error" } }, 500);
  });

  return app;
}

/** Resolve the API key bound to a specific upstream, with fallback to global active key. */
async function resolveUpstreamKey(
  upstreamId: string,
  keyStore: KeyStore,
  upstreamStore: UpstreamStore,
  runtimeConfig: RuntimeConfig
): Promise<string | null> {
  const u = await upstreamStore.getById(upstreamId);
  if (u?.keyId) {
    const plaintext = await keyStore.getPlaintext(u.keyId);
    if (plaintext) return plaintext;
  }
  // Fallback to global active key
  const activeKey = await runtimeConfig.getActiveKey();
  return activeKey?.plaintext ?? null;
}

// ── Streaming handler ──────────────────────────────────────────

interface LogMeta {
  requestId: string;
  startTime: number;
  model: string;
  upstreamId: string;
  keyId: string;
}

async function handleStreaming(
  c: Context,
  upstreamResp: Response,
  model: string,
  logStr: LogStore,
  meta: LogMeta
): Promise<Response> {
  if (!upstreamResp.body) {
    return c.json({ type: "error", error: { type: "api_error", message: "Empty upstream body" } }, 502);
  }

  let emittedTokens = 0;

  return streamSSE(c, async (stream) => {
    const emitter = new AnthropicStreamEmitter({
      onEvent: async (eventType, data) => {
        await stream.writeSSE({ data: JSON.stringify(data), event: eventType });
      },
      model,
    });

    const reader = upstreamResp.body!.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed.startsWith("data: ")) continue;

          const data = trimmed.slice(6);
          if (data === "[DONE]") { emitter.finish(); continue; }

          try {
            const chunk = JSON.parse(data);
            if (chunk.usage?.completion_tokens) {
              emittedTokens = chunk.usage.completion_tokens;
            }
            emitter.processChunk(chunk);
          } catch {}
        }

        if (stream.aborted) { reader.cancel(); break; }
      }

      if (buffer.trim().startsWith("data: ")) {
        const data = buffer.trim().slice(6);
        if (data !== "[DONE]") {
          try { emitter.processChunk(JSON.parse(data)); } catch {}
        }
        emitter.finish();
      }

      if (!emitter.isFinished) emitter.finish();
    } catch (err) {
      logger.error("Stream error", err as Error);
    }

    // Log after stream ends
    logStr.append({
      id: meta.requestId, ts: new Date().toISOString(),
      model: meta.model, stream: true,
      inputTokens: 0, outputTokens: emittedTokens,
      latencyMs: Date.now() - meta.startTime,
      status: "success", statusCode: 200,
      upstreamId: meta.upstreamId, keyId: meta.keyId,
      error: "", retries: 0,
    }).catch(() => {});
  });
}


