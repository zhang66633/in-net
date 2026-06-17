import { serve } from "@hono/node-server";
import { randomBytes } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { config } from "./config.js";
import { createApp } from "./server.js";
import { setDebug, logger } from "./logger.js";
import { KeyStore } from "./store/keys.js";
import { UpstreamStore } from "./store/upstreams.js";
import { LogStore } from "./store/logs.js";
import { RuntimeConfig } from "./runtime-config.js";
import { initEncryption, hashPassword } from "./store/crypto.js";

async function main() {
  setDebug(config.debug);

  // ── Initialize data directory and encryption ──────────────────
  await mkdir(config.dataDir, { recursive: true });
  const secretPath = join(config.dataDir, ".secret");
  let secret: Buffer;
  try {
    const hex = await readFile(secretPath, "utf-8");
    secret = Buffer.from(hex.trim(), "hex");
    if (secret.length !== 32) throw new Error("Invalid secret length");
  } catch {
    secret = randomBytes(32);
    await writeFile(secretPath, secret.toString("hex"), { mode: 0o600 });
    logger.info("Generated new encryption secret");
  }
  initEncryption(secret);

  // ── Initialize stores ─────────────────────────────────────────
  const keyStore = new KeyStore(config.dataDir, "keys.json");
  const upstreamStore = new UpstreamStore(config.dataDir, "upstreams.json");
  const logStore = new LogStore(config.dataDir);
  const runtimeConfig = new RuntimeConfig(config.dataDir, keyStore, upstreamStore);
  await runtimeConfig.init(config.upstream, config.defaultApiKey);

  // ── Admin password ────────────────────────────────────────────
  let adminPassword = config.adminPassword;
  const rtData = await runtimeConfig.getConfig();
  if (rtData.adminPasswordHash) {
    // Password already set
  } else if (adminPassword) {
    await runtimeConfig.setAdminPasswordHash(hashPassword(adminPassword));
  } else {
    // Auto-generate a password if none configured
    adminPassword = randomBytes(8).toString("hex");
    await runtimeConfig.setAdminPasswordHash(hashPassword(adminPassword));
  }

  // ── Startup banner ────────────────────────────────────────────
  console.log(`╔══════════════════════════════════════════════╗`);
  console.log(`║  in-net — Anthropic ↔ OpenAI API Relay      ║`);
  console.log(`╠══════════════════════════════════════════════╣`);
  console.log(`║  Proxy:     http://127.0.0.1:${config.port}/v1`.padEnd(46) + `║`);
  console.log(`║  Admin:     http://127.0.0.1:${config.port}/admin`.padEnd(46) + `║`);
  console.log(`║  Upstream:  ${config.upstream.padEnd(36)}║`);
  if (config.debug) {
    console.log(`║  Debug:     enabled                         ║`);
  }
  console.log(`║  Retry:     up to ${config.retry.maxRetries} times                      ║`);
  if (!config.adminPassword && !rtData.adminPasswordHash) {
    console.log(`║  Password:  ${adminPassword.padEnd(36)}║`);
  }
  console.log(`╚══════════════════════════════════════════════╝`);
  console.log();
  console.log(`  Claude Code:  ANTHROPIC_BASE_URL=http://127.0.0.1:${config.port}/v1 claude`);
  console.log(`  Admin Panel:  http://127.0.0.1:${config.port}/admin`);
  console.log();

  // ── Create and start server ───────────────────────────────────
  const app = createApp(config, runtimeConfig, keyStore, upstreamStore, logStore);

  const server = serve(
    { fetch: app.fetch, port: config.port, hostname: "127.0.0.1" },
    (info) => logger.info("Server started", { port: info.port })
  );

  // Graceful shutdown
  let shuttingDown = false;
  const shutdown = (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`\n[in-net] Received ${signal}, shutting down...`);
    server.close();
    process.exit(0);
  };
  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
}

main().catch((err) => {
  console.error("[in-net] Fatal error:", err);
  process.exit(1);
});
