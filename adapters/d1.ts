import type { Cache, Db } from "../core/ports.ts";

/**
 * Cloudflare adapters: D1 for storage, KV for the probe cache.
 */

type D1Database = {
  prepare(sql: string): {
    bind(...params: unknown[]): {
      all(): Promise<{ results: unknown[] }>;
      first(): Promise<unknown>;
      run(): Promise<{ meta?: { changes?: number } }>;
    };
  };
  exec(sql: string): Promise<unknown>;
};

export class D1Adapter implements Db {
  readonly dialect = "sqlite" as const;
  private readonly d1: D1Database;

  constructor(d1: D1Database) {
    this.d1 = d1;
  }

  async all<T>(sql: string, params: unknown[] = []): Promise<T[]> {
    const { results } = await this.d1.prepare(sql).bind(...params).all();
    return (results ?? []) as T[];
  }

  async first<T>(sql: string, params: unknown[] = []): Promise<T | null> {
    return ((await this.d1.prepare(sql).bind(...params).first()) ?? null) as T | null;
  }

  async run(sql: string, params: unknown[] = []): Promise<{ changes: number }> {
    const res = await this.d1.prepare(sql).bind(...params).run();
    return { changes: res.meta?.changes ?? 0 };
  }

  async exec(sql: string): Promise<void> {
    // D1's exec() is line-oriented, so DDL goes through prepare().run().
    // The statement is expected to be comment-free and single-line already
    // (see core/schema.ts), since a stray `--` would swallow the rest.
    await this.d1.prepare(sql).bind().run();
  }
}

type KVNamespace = {
  get(key: string): Promise<string | null>;
  put(key: string, value: string, options?: { expirationTtl?: number }): Promise<void>;
  delete(key: string): Promise<void>;
};

export class KvCache implements Cache {
  private readonly kv: KVNamespace;

  constructor(kv: KVNamespace) {
    this.kv = kv;
  }

  get(key: string): Promise<string | null> {
    return this.kv.get(key);
  }

  async set(key: string, value: string, ttlSeconds: number): Promise<void> {
    // KV rejects a TTL under 60 seconds.
    await this.kv.put(key, value, { expirationTtl: Math.max(60, Math.floor(ttlSeconds)) });
  }

  async delete(key: string): Promise<void> {
    await this.kv.delete(key);
  }
}
