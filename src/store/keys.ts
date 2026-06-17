import { randomUUID } from "node:crypto";
import { JsonStore } from "./base.js";
import { encrypt, decrypt } from "./crypto.js";
import type { ApiKeyEntry, ApiKeyInput, MaskedApiKey } from "../types/management.js";

interface KeysData {
  keys: ApiKeyEntry[];
}

export class KeyStore extends JsonStore<KeysData> {
  protected getDefault(): KeysData {
    return { keys: [] };
  }

  /** List all keys with masked values. */
  async list(): Promise<MaskedApiKey[]> {
    const data = await this.read();
    return data.keys.map(maskKey);
  }

  /** Get the plaintext of a key by ID (for proxy use). */
  async getPlaintext(id: string): Promise<string | null> {
    const data = await this.read();
    const entry = data.keys.find((k) => k.id === id);
    if (!entry) return null;
    return decrypt(entry.key);
  }

  /** Get the plaintext of the default key. */
  async getDefaultPlaintext(): Promise<string | null> {
    const data = await this.read();
    const entry = data.keys.find((k) => k.isDefault);
    if (!entry) return null;
    return decrypt(entry.key);
  }

  /** Create a new key. */
  async create(input: ApiKeyInput): Promise<MaskedApiKey> {
    const now = new Date().toISOString();
    const entry: ApiKeyEntry = {
      id: "k_" + randomUUID().slice(0, 12),
      name: input.name,
      key: encrypt(input.key),
      upstreamId: input.upstreamId || "",
      isDefault: false,
      notes: input.notes || "",
      createdAt: now,
      updatedAt: now,
    };

    const created = await this.update((data) => {
      // If first key, make it default
      if (data.keys.length === 0) entry.isDefault = true;
      data.keys.push(entry);
      return data;
    });

    return maskKey(created.keys.find((k) => k.id === entry.id)!);
  }

  /** Update a key's fields. */
  async updateKey(
    id: string,
    input: Partial<ApiKeyInput>
  ): Promise<MaskedApiKey | null> {
    return this.update((data) => {
      const idx = data.keys.findIndex((k) => k.id === id);
      if (idx === -1) return data;
      const entry = data.keys[idx];
      if (input.name !== undefined) entry.name = input.name;
      if (input.key !== undefined) entry.key = encrypt(input.key);
      if (input.upstreamId !== undefined) entry.upstreamId = input.upstreamId;
      if (input.notes !== undefined) entry.notes = input.notes;
      entry.updatedAt = new Date().toISOString();
      return data;
    }).then((data) => {
      const updated = data.keys.find((k) => k.id === id);
      return updated ? maskKey(updated) : null;
    });
  }

  /** Delete a key. */
  async deleteKey(id: string): Promise<boolean> {
    return this.update((data) => {
      const len = data.keys.length;
      data.keys = data.keys.filter((k) => k.id !== id);
      return data;
    }).then(() => true);
  }

  /** Set a key as the default. */
  async setDefault(id: string): Promise<boolean> {
    return this.update((data) => {
      for (const k of data.keys) k.isDefault = false;
      const target = data.keys.find((k) => k.id === id);
      if (target) target.isDefault = true;
      return data;
    }).then(() => true);
  }

  /** Reveal the plaintext of a key (requires re-auth — caller verifies password). */
  async reveal(id: string): Promise<string | null> {
    return this.getPlaintext(id);
  }
}

/** Mask a key for API responses: show only first 4 and last 4 chars. */
function maskKey(entry: ApiKeyEntry): MaskedApiKey {
  let masked = "sk-...xxxx";
  try {
    const plain = decrypt(entry.key);
    if (plain.length > 8) {
      masked = plain.slice(0, 4) + "..." + plain.slice(-4);
    } else if (plain.length > 0) {
      masked = plain.slice(0, 2) + "..." + plain.slice(-1);
    }
  } catch {
    // If decryption fails, return masked placeholder
    masked = "encrypted";
  }
  return { ...entry, key: masked };
}
