import { Hono } from "hono";
import { LogStore } from "../store/logs.js";
import type { LogQuery } from "../types/management.js";

export function createLogRoutes(logStore: LogStore): Hono {
  const router = new Hono();

  router.get("/api/logs", async (c) => {
    const query: LogQuery = {};

    const model = c.req.query("model");
    const status = c.req.query("status");
    const since = c.req.query("since");
    const until = c.req.query("until");
    const page = c.req.query("page");
    const limit = c.req.query("limit");

    if (model) query.model = model;
    if (status === "success" || status === "error") query.status = status;
    if (since) query.since = since;
    if (until) query.until = until;
    if (page) query.page = parseInt(page, 10);
    if (limit) query.limit = parseInt(limit, 10);

    const result = await logStore.query(query);
    return c.json(result);
  });

  router.get("/api/logs/:id", async (c) => {
    const entry = await logStore.getById(c.req.param("id"));
    if (!entry) return c.json({ error: "Not found" }, 404);
    return c.json(entry);
  });

  return router;
}
