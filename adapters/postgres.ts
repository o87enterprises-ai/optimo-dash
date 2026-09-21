import type { Cache, Db } from "../core/ports.ts";

/**
 * Self-hosted adapters: Postgres for storage, Redis for the probe cache.
 *
 * The services layer writes `?` placeholders, which is SQLite's syntax; this
 * adapter rewrites them to Postgres' positional `$1, $2, ...`.
 */

type PgPool = { query(sql: string, params?: unknown[]): Promise<{ rows: any[]; rowCount: number | null }> };

/**
 * Rewrites `?` to `$n`, leaving any `?` inside a string literal alone so a
 * query such as `COALESCE(country, '?')` is not corrupted.
 */
export function toPositional(sql: string): string {
  let out = "";
  let index = 0;
  let inString = false;

  for (let i = 0; i < sql.length; i++) {
    const ch = sql[i];
    if (ch === "'") {
      // '' inside a string is an escaped quote, not a terminator.
      if (inString && sql[i + 1] === "'") {
        out += "''";
        i++;
        continue;
      }
      inString = !inString;
      out += ch;
      continue;
    }
    out += !inString && ch === "?" ? `$${++index}` : ch;
  }
  return out;
}

export class PostgresAdapter implements Db {
  readonly dialect = "postgres" as const;
  private readonly pool: PgPool;

  constructor(pool: PgPool) {
    this.pool = pool;
  }

  async all<T>(sql: string, params: unknown[] = []): Promise<T[]> {
    const { rows } = await this.pool.query(toPositional(sql), params);
    return rows as T[];
  }

  async first<T>(sql: string, params: unknown[] = []): Promise<T | null> {
    const { rows } = await this.pool.query(toPositional(sql), params);
    return (rows[0] ?? null) as T | null;
  }

  async run(sql: string, params: unknown[] = []): Promise<{ changes: number }> {
    const res = await this.pool.query(toPositional(sql), params);
    return { changes: res.rowCount ?? 0 };
  }

  async exec(sql: string): Promise<void> {
    await this.pool.query(sql);
  }
}

type RedisLike = {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, mode: "EX", ttl: number): Promise<unknown>;
  del(key: string): Promise<unknown>;
};

export class RedisCache implements Cache {
  private readonly redis: RedisLike;

  constructor(redis: RedisLike) {
    this.redis = redis;
  }

  async get(key: string): Promise<string | null> {
    return this.redis.get(key).catch(() => null);
  }

  async set(key: string, value: string, ttlSeconds: number): Promise<void> {
    // A cache failure must never fail the request that produced the value.
    await this.redis.set(key, value, "EX", Math.max(1, Math.floor(ttlSeconds))).catch(() => undefined);
  }

  async delete(key: string): Promise<void> {
    await this.redis.del(key).catch(() => undefined);
  }
}
