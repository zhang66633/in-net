import { readFile, writeFile, mkdir, rename } from "node:fs/promises";
import { dirname } from "node:path";

/**
 * Generic JSON file store with atomic writes and in-memory caching.
 * All management data stores extend this.
 */
export abstract class JsonStore<T> {
  protected filePath: string;
  private cache: T | null = null;

  constructor(dataDir: string, filename: string) {
    this.filePath = `${dataDir}/${filename}`;
  }

  protected abstract getDefault(): T;

  /** Read the full store, using cache if available. */
  async read(): Promise<T> {
    if (this.cache) return this.cache;
    try {
      const raw = await readFile(this.filePath, "utf-8");
      this.cache = JSON.parse(raw) as T;
      return this.cache!;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") {
        const def = this.getDefault();
        await this.write(def);
        return def;
      }
      throw err;
    }
  }

  /** Write the full store atomically (write tmp → rename). */
  async write(data: T): Promise<void> {
    await mkdir(dirname(this.filePath), { recursive: true });
    const tmp = this.filePath + ".tmp";
    await writeFile(tmp, JSON.stringify(data, null, 2), "utf-8");
    await rename(tmp, this.filePath);
    this.cache = data;
  }

  /** Atomic read-modify-write with a callback. */
  async update(fn: (current: T) => T): Promise<T> {
    const current = await this.read();
    const next = fn(current);
    await this.write(next);
    return next;
  }

  /** Invalidate cache so next read() re-reads from disk. */
  invalidate(): void {
    this.cache = null;
  }
}
