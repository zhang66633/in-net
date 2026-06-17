import { randomUUID } from "node:crypto";
import { appendFile, readFile, writeFile, mkdir, rename } from "node:fs/promises";
import { dirname } from "node:path";
import type { LogEntry, LogQuery, PaginatedResult } from "../types/management.js";

const MAX_LOG_LINES = 10_000;

export class LogStore {
  private filePath: string;

  constructor(dataDir: string) {
    this.filePath = `${dataDir}/logs.jsonl`;
  }

  /** Append a log entry (fire-and-forget, non-blocking). */
  async append(entry: LogEntry): Promise<void> {
    await mkdir(dirname(this.filePath), { recursive: true });
    const line = JSON.stringify(entry) + "\n";
    await appendFile(this.filePath, line, "utf-8");
    this.rotateIfNeeded().catch(() => {});
  }

  /** Query logs with pagination and filters. */
  async query(q: LogQuery = {}): Promise<PaginatedResult<LogEntry>> {
    const page = q.page ?? 1;
    const limit = Math.min(q.limit ?? 50, 200);

    let all: LogEntry[] = [];
    try {
      const raw = await readFile(this.filePath, "utf-8");
      all = raw
        .trim()
        .split("\n")
        .filter(Boolean)
        .map((line) => JSON.parse(line) as LogEntry)
        .reverse(); // newest first
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") {
        return { entries: [], total: 0, page, limit, hasMore: false };
      }
      throw err;
    }

    if (q.model) all = all.filter((e) => e.model.includes(q.model!));
    if (q.status) all = all.filter((e) => e.status === q.status);
    if (q.since) all = all.filter((e) => e.ts >= q.since!);
    if (q.until) all = all.filter((e) => e.ts <= q.until!);

    const total = all.length;
    const start = (page - 1) * limit;
    const entries = all.slice(start, start + limit);

    return { entries, total, page, limit, hasMore: start + limit < total };
  }

  /** Get stats since a given epoch ms. */
  async getStats(sinceMs: number): Promise<{
    totalRequests: number;
    totalTokens: number;
    avgLatencyMs: number;
    successRate: number;
    byModel: Record<string, { count: number; tokens: number }>;
    byStatus: Record<string, number>;
  }> {
    let all: LogEntry[] = [];
    try {
      const raw = await readFile(this.filePath, "utf-8");
      all = raw
        .trim()
        .split("\n")
        .filter(Boolean)
        .map((line) => JSON.parse(line) as LogEntry);
    } catch {
      return emptyStats();
    }

    if (sinceMs > 0) {
      const since = new Date(sinceMs).toISOString();
      all = all.filter((e) => e.ts >= since);
    }

    if (all.length === 0) return emptyStats();

    const totalTokens = all.reduce((s, e) => s + e.inputTokens + e.outputTokens, 0);
    const avgLatencyMs = Math.round(all.reduce((s, e) => s + e.latencyMs, 0) / all.length);
    const successCount = all.filter((e) => e.status === "success").length;
    const successRate = all.length > 0 ? successCount / all.length : 0;

    const byModel: Record<string, { count: number; tokens: number }> = {};
    const byStatus: Record<string, number> = { success: 0, error: 0 };

    for (const e of all) {
      if (!byModel[e.model]) byModel[e.model] = { count: 0, tokens: 0 };
      byModel[e.model].count++;
      byModel[e.model].tokens += e.inputTokens + e.outputTokens;
      byStatus[e.status]++;
    }

    return { totalRequests: all.length, totalTokens, avgLatencyMs, successRate, byModel, byStatus };
  }

  /** Get a single log entry by ID. */
  async getById(id: string): Promise<LogEntry | null> {
    try {
      const raw = await readFile(this.filePath, "utf-8");
      for (const line of raw.trim().split("\n").filter(Boolean)) {
        const entry = JSON.parse(line) as LogEntry;
        if (entry.id === id) return entry;
      }
    } catch {}
    return null;
  }

  /** Rotate log file if over limit. */
  private async rotateIfNeeded(): Promise<void> {
    try {
      const raw = await readFile(this.filePath, "utf-8");
      const lines = raw.trim().split("\n").filter(Boolean);
      if (lines.length > MAX_LOG_LINES) {
        const keep = lines.slice(-Math.floor(MAX_LOG_LINES / 2));
        const tmp = this.filePath + ".tmp";
        await writeFile(tmp, keep.join("\n") + "\n");
        await rename(tmp, this.filePath);
      }
    } catch {}
  }
}

function emptyStats() {
  return {
    totalRequests: 0, totalTokens: 0, avgLatencyMs: 0, successRate: 0,
    byModel: {} as Record<string, { count: number; tokens: number }>,
    byStatus: { success: 0, error: 0 },
  };
}
