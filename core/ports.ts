/**
 * Runtime ports.
 *
 * The services layer talks only to these interfaces, so the same business
 * logic runs on Cloudflare (D1 + KV) and on a self-hosted box (Postgres +
 * Redis). Adapters live in adapters/.
 */

export interface Db {
  /** Returns every matching row. */
  all<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]>;
  /** Returns the first row, or null. */
  first<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T | null>;
  /** Runs a statement, returning how many rows it changed. */
  run(sql: string, params?: unknown[]): Promise<{ changes: number }>;
  /** Runs one or more DDL statements. Used by migrations only. */
  exec(sql: string): Promise<void>;
  /** Which dialect is underneath, for the few places it genuinely matters. */
  readonly dialect: "sqlite" | "postgres";
}

export interface Cache {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, ttlSeconds: number): Promise<void>;
  delete(key: string): Promise<void>;
}

/** Fan-out for live updates. A no-op implementation is valid. */
export interface Bus {
  publish(event: Record<string, unknown>): Promise<void>;
}

/** Everything a request handler needs from its runtime. */
export type Ctx = {
  db: Db;
  cache: Cache;
  bus: Bus;
  /** Deployment-level configuration (ENCRYPTION_KEY, PBKDF2_ITERATIONS, ...). */
  env: Record<string, string | undefined>;
};

/* ---------- Portable SQL helpers ---------- */

/**
 * Booleans are stored as 0/1 integers in both dialects so that predicates like
 * `cited = 1` are portable. Postgres BOOLEAN and SQLite's lack of one would
 * otherwise force dialect-specific SQL through the whole services layer.
 */
export const TRUE = 1;
export const FALSE = 0;

/** Coerces a stored 0/1 (or pg boolean) to a real boolean for JSON output. */
export function toBool(value: unknown): boolean {
  return value === 1 || value === true || value === "1" || value === "t";
}

/** Timestamps are ISO-8601 TEXT in both dialects, so sorting is lexicographic. */
export function now(): string {
  return new Date().toISOString();
}

/** Builds `?,?,?` for an IN clause of the given length. */
export function placeholders(count: number): string {
  return new Array(count).fill("?").join(",");
}
