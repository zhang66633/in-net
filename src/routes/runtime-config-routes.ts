import { Hono } from "hono";
import type { RuntimeConfig } from "../runtime-config.js";

export function createRuntimeConfigRoutes(runtimeConfig: RuntimeConfig): Hono {
  const router = new Hono();

  router.get("/api/config", async (c) => {
    const data = await runtimeConfig.getConfig();
    return c.json({
      activeKeyId: data.activeKeyId,
      activeUpstreamId: data.activeUpstreamId,
      loadBalancing: data.loadBalancing,
    });
  });

  router.put("/api/config", async (c) => {
    const body = await c.req.json<{
      activeKeyId?: string;
      activeUpstreamId?: string;
      loadBalancing?: "active" | "round-robin";
    }>();

    if (body.activeKeyId) await runtimeConfig.setActiveKey(body.activeKeyId);
    if (body.activeUpstreamId) await runtimeConfig.setActiveUpstream(body.activeUpstreamId);
    if (body.loadBalancing) await runtimeConfig.setLoadBalancing(body.loadBalancing);

    const data = await runtimeConfig.getConfig();
    return c.json({
      activeKeyId: data.activeKeyId,
      activeUpstreamId: data.activeUpstreamId,
      loadBalancing: data.loadBalancing,
    });
  });

  return router;
}
