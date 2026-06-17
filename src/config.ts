import { homedir } from "node:os";
import { join } from "node:path";
import { parseArgs } from "node:util";
import type { RetryConfig } from "./proxy.js";

export interface Config {
  port: number;
  upstream: string;
  defaultApiKey: string;
  debug: boolean;
  retry: RetryConfig;
  dataDir: string;
  adminPassword: string;
}

function parseCliArgs() {
  return parseArgs({
    options: {
      port: { type: "string", short: "p" },
      upstream: { type: "string", short: "u" },
      "api-key": { type: "string", short: "k" },
      debug: { type: "boolean", short: "d", default: false },
      retry: { type: "string", short: "r" },
      "data-dir": { type: "string" },
      "admin-password": { type: "string" },
    },
    strict: false,
  });
}

function resolveConfig(): Config {
  const cli = parseCliArgs();

  const cliPort = (cli.values.port as string | undefined) ?? undefined;
  const cliUpstream = (cli.values.upstream as string | undefined) ?? undefined;
  const cliApiKey = (cli.values["api-key"] as string | undefined) ?? undefined;
  const cliDebug = (cli.values.debug as boolean | undefined) ?? undefined;
  const cliRetry = (cli.values.retry as string | undefined) ?? undefined;
  const cliDataDir = (cli.values["data-dir"] as string | undefined) ?? undefined;
  const cliAdminPw = (cli.values["admin-password"] as string | undefined) ?? undefined;

  const portStr: string = cliPort ?? process.env.IN_NET_PORT ?? "8787";
  const port = parseInt(portStr, 10);
  if (isNaN(port) || port < 1024 || port > 65535) {
    console.error(`[in-net] Invalid port: ${portStr}`);
    process.exit(1);
  }

  const upstream: string =
    cliUpstream ?? process.env.IN_NET_UPSTREAM ?? "https://your-upstream-url/v1/chat/completions";
  try { new URL(upstream); } catch {
    console.error(`[in-net] Invalid upstream URL: ${upstream}`);
    process.exit(1);
  }

  const defaultApiKey: string = cliApiKey ?? process.env.IN_NET_API_KEY ?? "";
  const debug: boolean = cliDebug ?? process.env.IN_NET_DEBUG === "true";
  const retryStr = cliRetry ?? process.env.IN_NET_RETRY ?? "3";
  const maxRetries = Math.max(0, Math.min(10, parseInt(retryStr, 10) || 3));

  const dataDir: string = cliDataDir ?? process.env.IN_NET_DATA_DIR ?? join(homedir(), ".in-net");
  const adminPassword: string = cliAdminPw ?? process.env.IN_NET_ADMIN_PASSWORD ?? "";

  return {
    port, upstream, defaultApiKey, debug,
    retry: { maxRetries, baseDelayMs: 1000 },
    dataDir, adminPassword,
  };
}

export const config: Config = resolveConfig();
