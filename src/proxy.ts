import type { OpenAiChatRequest } from "./types/openai.js";
import { logger } from "./logger.js";

export interface RetryConfig {
  maxRetries: number;    // max retry attempts (default: 3)
  baseDelayMs: number;   // base delay before first retry (default: 1000)
}

const DEFAULT_RETRY: RetryConfig = {
  maxRetries: 3,
  baseDelayMs: 1000,
};

/**
 * Check if an upstream error response is worth retrying.
 * Retry on: 5xx server errors, 429 rate limits, and New API transient
 * "模型不存在" errors (caused by channel contention).
 */
function isRetryable(status: number, body: string): boolean {
  // Server errors
  if (status >= 500) return true;
  // Rate limiting
  if (status === 429) return true;
  // New API transient: "模型不存在或已下架" — often caused by channel contention
  if (status === 400 && body.includes("模型不存在")) return true;
  return false;
}

/**
 * Forwards a translated OpenAI-format request to the upstream API
 * with automatic retry on transient errors.
 */
export async function proxyToUpstream(
  body: OpenAiChatRequest,
  upstreamUrl: string,
  apiKey: string,
  signal?: AbortSignal,
  retryConfig: RetryConfig = DEFAULT_RETRY
): Promise<Response> {
  let lastResponse: Response | null = null;
  const maxAttempts = 1 + retryConfig.maxRetries;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    // Check if client disconnected
    if (signal?.aborted) {
      throw new DOMException("Client disconnected", "AbortError");
    }

    if (attempt > 0) {
      const delay = retryConfig.baseDelayMs * Math.pow(2, attempt - 1);
      logger.debug("Retrying upstream request", {
        attempt: attempt + 1,
        maxAttempts,
        delayMs: delay,
      });
      await sleep(delay, signal);
    }

    try {
      const resp = await fetch(upstreamUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify(body),
        signal,
      });

      // Success — return immediately
      if (resp.ok) return resp;

      // Check if retryable
      const bodyText = await resp.clone().text();
      if (attempt < retryConfig.maxRetries && isRetryable(resp.status, bodyText)) {
        logger.debug("Upstream returned retryable error", {
          status: resp.status,
          attempt: attempt + 1,
        });
        lastResponse = resp;
        continue;
      }

      // Non-retryable — return as-is
      return resp;
    } catch (err) {
      const error = err as Error;
      // Don't retry on abort
      if (error.name === "AbortError") throw error;
      // Network errors are retryable
      if (attempt < retryConfig.maxRetries) {
        logger.debug("Network error, will retry", {
          error: error.message,
          attempt: attempt + 1,
        });
        lastResponse = null;
        continue;
      }
      throw error;
    }
  }

  // All retries exhausted — return the last error response
  return lastResponse!;
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    if (signal) {
      const onAbort = () => {
        clearTimeout(timer);
        reject(new DOMException("Client disconnected", "AbortError"));
      };
      signal.addEventListener("abort", onAbort, { once: true });
    }
  });
}
