import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { JsonStore } from "./store/base.js";
import type { RuntimeConfigData } from "./types/management.js";
import { KeyStore } from "./store/keys.js";
import { UpstreamStore } from "./store/upstreams.js";

/**
 * Runtime configuration manager — the bridge between the management UI
 * and the proxy layer. Stores active key/upstream selection in runtime.json.
 */
export class RuntimeConfig {
  private store: JsonStore<RuntimeConfigData>;
  private keyStore: KeyStore;
  private upstreamStore: UpstreamStore;
  private roundRobinIdx = 0;

  constructor(
    dataDir: string,
    keyStore: KeyStore,
    upstreamStore: UpstreamStore
  ) {
    this.store = new (class extends JsonStore<RuntimeConfigData> {
      constructor(dp: string) {
        super(dp, "runtime.json");
      }
      protected getDefault(): RuntimeConfigData {
        return {
          activeKeyId: "",
          activeUpstreamId: "",
          loadBalancing: "active",
          adminPasswordHash: "",
        };
      }
    })(dataDir);
    this.keyStore = keyStore;
    this.upstreamStore = upstreamStore;
  }

  /** Initialize: load from disk, auto-populate from CLI/env if empty. */
  async init(defaultUpstreamUrl: string, defaultApiKey: string): Promise<void> {
    const data = await this.store.read();

    // Auto-create upstream from CLI/env if none exist
    const upstreams = await this.upstreamStore.list();
    if (upstreams.length === 0 && defaultUpstreamUrl) {
      const created = await this.upstreamStore.create({
        name: "Default",
        url: defaultUpstreamUrl,
      });
      await this.upstreamStore.setActive(created.id);
      data.activeUpstreamId = created.id;
    }

    // Auto-create key from CLI/env if none exist
    const keys = await this.keyStore.list();
    if (keys.length === 0 && defaultApiKey) {
      await this.keyStore.create({
        name: "Default",
        key: defaultApiKey,
      });
      await this.keyStore.setDefault(keys.length === 0 ? "" : keys[0].id);
      // Get the newly created key's ID
      const newKeys = await this.keyStore.list();
      if (newKeys.length > 0) {
        data.activeKeyId = newKeys[0].id;
      }
    }

    // Ensure activeKeyId / activeUpstreamId point to something valid
    if (!data.activeUpstreamId || !(await this.upstreamStore.getById(data.activeUpstreamId))) {
      const active = await this.upstreamStore.getActive();
      if (active) data.activeUpstreamId = active.id;
    }
    if (!data.activeKeyId) {
      const allKeys = await this.keyStore.list();
      if (allKeys.length > 0) data.activeKeyId = allKeys[0].id;
    }

    await this.store.write(data);
  }

  /** Get the currently active API key plaintext. */
  async getActiveKey(): Promise<{ id: string; plaintext: string } | null> {
    const data = await this.store.read();
    if (data.activeKeyId) {
      const plaintext = await this.keyStore.getPlaintext(data.activeKeyId);
      if (plaintext) return { id: data.activeKeyId, plaintext };
    }
    // Fallback: try default key
    const pts = await this.keyStore.getDefaultPlaintext();
    if (pts) {
      const keys = await this.keyStore.list();
      const def = keys.find((k) => k.isDefault);
      return { id: def?.id ?? "", plaintext: pts };
    }
    return null;
  }

  /** Get the currently active upstream. */
  async getActiveUpstream(): Promise<{ id: string; url: string } | null> {
    const data = await this.store.read();
    if (data.loadBalancing === "round-robin") {
      const all = await this.upstreamStore.getAllUrls();
      if (all.length > 0) {
        this.roundRobinIdx = (this.roundRobinIdx + 1) % all.length;
        return all[this.roundRobinIdx];
      }
    }
    if (data.activeUpstreamId) {
      const u = await this.upstreamStore.getById(data.activeUpstreamId);
      if (u) return { id: u.id, url: u.url };
    }
    const active = await this.upstreamStore.getActive();
    return active ? { id: active.id, url: active.url } : null;
  }

  /** Set active key. */
  async setActiveKey(keyId: string): Promise<void> {
    await this.store.update((d) => ({ ...d, activeKeyId: keyId }));
  }

  /** Set active upstream. */
  async setActiveUpstream(upstreamId: string): Promise<void> {
    await this.store.update((d) => ({ ...d, activeUpstreamId: upstreamId }));
  }

  /** Set load balancing mode. */
  async setLoadBalancing(mode: "active" | "round-robin"): Promise<void> {
    await this.store.update((d) => ({ ...d, loadBalancing: mode }));
  }

  /** Get full runtime config (for API). */
  async getConfig(): Promise<RuntimeConfigData> {
    return this.store.read();
  }

  /** Get the plaintext of a key by ID (for upstream-bound key resolution). */
  async getKeyPlaintextById(keyId: string): Promise<string | null> {
    return this.keyStore.getPlaintext(keyId);
  }

  /** Get admin password hash. */
  async getAdminPasswordHash(): Promise<string> {
    const d = await this.store.read();
    return d.adminPasswordHash;
  }

  /** Set admin password hash. */
  async setAdminPasswordHash(hash: string): Promise<void> {
    await this.store.update((d) => ({ ...d, adminPasswordHash: hash }));
  }
}
