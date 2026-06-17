import { randomBytes, createCipheriv, createDecipheriv, scryptSync } from "node:crypto";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 16;
const TAG_LENGTH = 16;
const PREFIX = "enc:aes256gcm:";

let SECRET: Buffer | null = null;

/** Call once at startup with the contents of .in-net/.secret */
export function initEncryption(secretKey: Buffer): void {
  if (secretKey.length !== 32) {
    throw new Error("Encryption secret must be 32 bytes");
  }
  SECRET = secretKey;
}

/** Encrypt plaintext → "enc:aes256gcm:iv:ciphertext:tag" (all base64) */
export function encrypt(plaintext: string): string {
  if (!SECRET) throw new Error("Encryption not initialized");
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, SECRET, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf-8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${PREFIX}${iv.toString("base64")}:${encrypted.toString("base64")}:${tag.toString("base64")}`;
}

/** Decrypt "enc:aes256gcm:..." → plaintext. Returns input as-is if not encrypted. */
export function decrypt(encoded: string): string {
  if (!encoded.startsWith(PREFIX)) return encoded; // legacy plaintext
  if (!SECRET) throw new Error("Encryption not initialized");
  const parts = encoded.slice(PREFIX.length).split(":");
  if (parts.length !== 3) throw new Error("Invalid encrypted format");
  const iv = Buffer.from(parts[0], "base64");
  const encrypted = Buffer.from(parts[1], "base64");
  const tag = Buffer.from(parts[2], "base64");
  const decipher = createDecipheriv(ALGORITHM, SECRET, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString("utf-8");
}

/** Hash password with scrypt. Format: "scrypt:saltHex:derivedHex" */
export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString("hex");
  const derived = scryptSync(password, salt, 64).toString("hex");
  return `scrypt:${salt}:${derived}`;
}

/** Verify password against a "scrypt:salt:derived" hash */
export function verifyPassword(password: string, hash: string): boolean {
  const parts = hash.split(":");
  if (parts.length !== 3 || parts[0] !== "scrypt") return false;
  const salt = parts[1];
  const expected = parts[2];
  const derived = scryptSync(password, salt, 64).toString("hex");
  return derived === expected;
}
