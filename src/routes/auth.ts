import { Hono, type Context, type Next } from "hono";
import { getCookie, setCookie, deleteCookie } from "hono/cookie";
import { verifyPassword } from "../store/crypto.js";
import type { RuntimeConfig } from "../runtime-config.js";

const COOKIE_NAME = "in-net-session";
const SESSION_TTL = 24 * 60 * 60 * 1000; // 24h

/** Create auth middleware and routes. */
export function createAuthRoutes(runtimeConfig: RuntimeConfig): Hono {
  const router = new Hono();

  router.post("/api/auth/login", async (c) => {
    const { password } = await c.req.json<{ password?: string }>().catch(() => ({ password: "" }));
    const hash = await runtimeConfig.getAdminPasswordHash();

    // If no password configured, auth is skipped
    if (!hash) {
      setCookie(c, COOKIE_NAME, "open", { httpOnly: true, maxAge: SESSION_TTL / 1000, path: "/" });
      return c.json({ token: "open", authenticated: true });
    }

    if (!password || !verifyPassword(password, hash)) {
      return c.json({ error: "Invalid password" }, 401);
    }

    const token = Buffer.from(`sess:${Date.now()}`).toString("base64");
    setCookie(c, COOKIE_NAME, token, { httpOnly: true, maxAge: SESSION_TTL / 1000, path: "/" });
    return c.json({ token, authenticated: true });
  });

  router.get("/api/auth/status", (c) => {
    const cookie = getCookie(c, COOKIE_NAME);
    return c.json({ authenticated: !!cookie });
  });

  router.post("/api/auth/logout", (c) => {
    deleteCookie(c, COOKIE_NAME);
    return c.json({ ok: true });
  });

  return router;
}

/** Middleware that protects /api/* routes. */
export async function authMiddleware(
  c: Context,
  next: Next,
  runtimeConfig: RuntimeConfig
): Promise<void | Response> {
  const hash = await runtimeConfig.getAdminPasswordHash();

  // No password configured = open access (localhost convenience)
  if (!hash) {
    // Set a cookie so the frontend knows auth is open
    if (!getCookie(c, COOKIE_NAME)) {
      setCookie(c, COOKIE_NAME, "open", { httpOnly: true, maxAge: SESSION_TTL / 1000, path: "/" });
    }
    await next();
    return;
  }

  // Check cookie
  const cookie = getCookie(c, COOKIE_NAME);
  // Also accept X-In-Net-Auth header
  const header = c.req.header("X-In-Net-Auth");

  if (!cookie && !header) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  // If header provided, verify it as password
  if (header && !verifyPassword(header, hash)) {
    return c.json({ error: "Invalid password" }, 401);
  }

  await next();
}
