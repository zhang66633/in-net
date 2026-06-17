import { Hono } from "hono";
import { LogStore } from "../store/logs.js";

export function createStatsRoutes(logStore: LogStore): Hono {
  const router = new Hono();

  router.get("/api/stats", async (c) => {
    const period = c.req.query("period") ?? "24h";

    let sinceMs = 0;
    const now = Date.now();
    switch (period) {
      case "7d": sinceMs = now - 7 * 24 * 60 * 60 * 1000; break;
      case "30d": sinceMs = now - 30 * 24 * 60 * 60 * 1000; break;
      case "all": sinceMs = 0; break;
      default: sinceMs = now - 24 * 60 * 60 * 1000; break;
    }

    const raw = await logStore.getStats(sinceMs);

    // Flatten byModel to array for JSON consumption
    const byModel = Object.entries(raw.byModel).map(([model, v]) => ({
      model,
      count: v.count,
      tokens: v.tokens,
    }));

    const byStatus = Object.entries(raw.byStatus).map(([status, count]) => ({
      status,
      count,
    }));

    return c.json({
      totalRequests: raw.totalRequests,
      totalTokens: raw.totalTokens,
      avgLatencyMs: raw.avgLatencyMs,
      successRate: Math.round(raw.successRate * 10000) / 10000,
      byModel,
      byStatus,
    });
  });

  return router;
}
