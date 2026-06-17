import { Hono } from "hono";
import { UpstreamStore } from "../store/upstreams.js";
import type { Config } from "../config.js";
import type { RuntimeConfig } from "../runtime-config.js";

export function createUpstreamRoutes(
  upstreamStore: UpstreamStore,
  config: Config,
  runtimeConfig: RuntimeConfig
): Hono {
  const router = new Hono();

  router.get("/api/upstreams", async (c) => {
    const upstreams = await upstreamStore.list();
    return c.json(upstreams);
  });

  router.post("/api/upstreams", async (c) => {
    const body = await c.req.json();
    if (!body.name || !body.url) {
      return c.json({ error: "name and url are required" }, 400);
    }
    try { new URL(body.url); } catch {
      return c.json({ error: "Invalid URL" }, 400);
    }
    const created = await upstreamStore.create(body);
    await runtimeConfig.setActiveUpstream(created.id);
    return c.json(created, 201);
  });

  router.put("/api/upstreams/:id", async (c) => {
    const id = c.req.param("id");
    const body = await c.req.json();
    if (body.url) {
      try { new URL(body.url); } catch {
        return c.json({ error: "Invalid URL" }, 400);
      }
    }
    const updated = await upstreamStore.updateUpstream(id, body);
    if (!updated) return c.json({ error: "Not found" }, 404);
    return c.json(updated);
  });

  router.delete("/api/upstreams/:id", async (c) => {
    const id = c.req.param("id");
    const upstreams = await upstreamStore.list();
    if (upstreams.length <= 1) {
      return c.json({ error: "Cannot delete the last upstream" }, 400);
    }
    await upstreamStore.deleteUpstream(id);
    return c.json({ ok: true });
  });

  router.post("/api/upstreams/:id/activate", async (c) => {
    const id = c.req.param("id");
    await upstreamStore.setActive(id);
    await runtimeConfig.setActiveUpstream(id);
    return c.json({ ok: true });
  });

  router.post("/api/upstreams/:id/test", async (c) => {
    const id = c.req.param("id");
    const u = await upstreamStore.getById(id);
    if (!u) return c.json({ error: "Not found" }, 404);

    const baseUrl = u.url.replace(/\/chat\/completions\/?$/, "");
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 10000);
      // Get API key: upstream-bound key > global active key > CLI default
      let apiKey = "";
      if (u.keyId) {
        apiKey = (await runtimeConfig.getKeyPlaintextById(u.keyId)) || "";
      }
      if (!apiKey) {
        const activeKey = await runtimeConfig.getActiveKey();
        apiKey = activeKey?.plaintext || config.defaultApiKey || "";
      }
      const headers: Record<string, string> = {};
      if (apiKey) headers.Authorization = `Bearer ${apiKey}`;

      const resp = await fetch(`${baseUrl}/models`, {
        signal: controller.signal,
        headers,
      });
      clearTimeout(timeout);

      if (resp.ok) {
        const body = await resp.json() as { data?: { id: string }[] };
        const models = body?.data ?? [];
        return c.json({ ok: true, models: models.map((m) => m.id) });
      } else {
        return c.json({ ok: false, error: `HTTP ${resp.status}` });
      }
    } catch (err) {
      return c.json({ ok: false, error: (err as Error).message });
    }
  });

  return router;
}
