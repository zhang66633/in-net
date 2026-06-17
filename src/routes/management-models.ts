import { Hono } from "hono";
import type { Config } from "../config.js";
import type { RuntimeConfig } from "../runtime-config.js";
import type { KeyStore } from "../store/keys.js";
import type { UpstreamStore } from "../store/upstreams.js";

export function createManagementModelsRoutes(
  config: Config,
  runtimeConfig: RuntimeConfig,
  keyStore: KeyStore,
  upstreamStore: UpstreamStore
): Hono {
  const router = new Hono();

  router.get("/api/management-models", async (c) => {
    const upstream = await runtimeConfig.getActiveUpstream();
    if (!upstream) {
      return c.json({ error: "No upstream configured" }, 503);
    }

    // Resolve key: upstream-bound key > global active key > CLI default
    let apiKey = "";
    const u = await upstreamStore.getById(upstream.id);
    if (u?.keyId) {
      apiKey = (await keyStore.getPlaintext(u.keyId)) || "";
    }
    if (!apiKey) {
      const activeKey = await runtimeConfig.getActiveKey();
      apiKey = activeKey?.plaintext || config.defaultApiKey || "";
    }
    if (!apiKey) {
      return c.json({ error: "No API key configured" }, 401);
    }

    const baseUrl = upstream.url.replace(/\/chat\/completions\/?$/, "");
    try {
      const resp = await fetch(`${baseUrl}/models`, {
        headers: { Authorization: `Bearer ${apiKey}` },
        signal: c.req.raw.signal,
      });

      if (!resp.ok) {
        return c.json({ error: `Upstream returned ${resp.status}` }, 502);
      }

      const body = await resp.json() as { data?: { id: string; object: string; owned_by?: string }[] };
      const models = (body.data ?? []).map((m: { id: string; owned_by?: string }) => ({
        id: m.id,
        ownedBy: m.owned_by ?? "unknown",
      }));

      return c.json({
        upstreamName: upstream.id,
        upstreamUrl: upstream.url,
        models,
      });
    } catch (err) {
      return c.json({ error: (err as Error).message }, 502);
    }
  });

  return router;
}
