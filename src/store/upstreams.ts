import { randomUUID } from "node:crypto";
import { JsonStore } from "./base.js";
import type { UpstreamEntry, UpstreamInput } from "../types/management.js";

interface UpstreamsData {
  upstreams: UpstreamEntry[];
}

export class UpstreamStore extends JsonStore<UpstreamsData> {
  protected getDefault(): UpstreamsData {
    return { upstreams: [] };
  }

  async list(): Promise<UpstreamEntry[]> {
    const data = await this.read();
    return data.upstreams;
  }

  /** Get active upstream. */
  async getActive(): Promise<UpstreamEntry | null> {
    const data = await this.read();
    return data.upstreams.find((u) => u.isActive) ?? null;
  }

  /** Get upstream by ID. */
  async getById(id: string): Promise<UpstreamEntry | null> {
    const data = await this.read();
    return data.upstreams.find((u) => u.id === id) ?? null;
  }

  /** Create a new upstream. */
  async create(input: UpstreamInput): Promise<UpstreamEntry> {
    const now = new Date().toISOString();
    const entry: UpstreamEntry = {
      id: "up_" + randomUUID().slice(0, 12),
      name: input.name,
      url: input.url,
      keyId: input.keyId || "",
      isActive: false,
      createdAt: now,
      updatedAt: now,
    };

    await this.update((data) => {
      if (data.upstreams.length === 0) entry.isActive = true;
      data.upstreams.push(entry);
      return data;
    });

    return entry;
  }

  /** Update an upstream's fields. */
  async updateUpstream(
    id: string,
    input: Partial<UpstreamInput>
  ): Promise<UpstreamEntry | null> {
    return this.update((data) => {
      const idx = data.upstreams.findIndex((u) => u.id === id);
      if (idx === -1) return data;
      if (input.name !== undefined) data.upstreams[idx].name = input.name;
      if (input.url !== undefined) data.upstreams[idx].url = input.url;
      if (input.keyId !== undefined) data.upstreams[idx].keyId = input.keyId;
      data.upstreams[idx].updatedAt = new Date().toISOString();
      return data;
    }).then((data) => data.upstreams.find((u) => u.id === id) ?? null);
  }

  /** Delete an upstream. */
  async deleteUpstream(id: string): Promise<boolean> {
    await this.update((data) => {
      data.upstreams = data.upstreams.filter((u) => u.id !== id);
      return data;
    });
    return true;
  }

  /** Set an upstream as active. */
  async setActive(id: string): Promise<boolean> {
    await this.update((data) => {
      for (const u of data.upstreams) u.isActive = false;
      const target = data.upstreams.find((u) => u.id === id);
      if (target) target.isActive = true;
      return data;
    });
    return true;
  }

  /** Get all upstream URLs for round-robin. */
  async getAllUrls(): Promise<{ id: string; url: string }[]> {
    const data = await this.read();
    return data.upstreams.map((u) => ({ id: u.id, url: u.url }));
  }
}
