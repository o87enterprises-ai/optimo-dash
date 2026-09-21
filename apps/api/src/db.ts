import "./env";
import Redis from "ioredis";
import { Pool } from "pg";

/**
 * Single Pool / Redis client shared by every route and connector. Creating
 * these per-module would exhaust Postgres connections on Termux, where
 * max_connections is low.
 */
export const pg = new Pool({ connectionString: process.env.DATABASE_URL });

export const redis = new Redis(process.env.REDIS_URL || "redis://localhost:6379", {
  maxRetriesPerRequest: 2,
  lazyConnect: false,
});

// ioredis throws an unhandled 'error' event if nothing listens; a dead cache
// should degrade the dashboard, not crash the API.
redis.on("error", (e) => console.error("[redis]", e.message));

/** Channel used to fan out live updates to every connected SSE client. */
export const UPDATES_CHANNEL = "dash:updates";

/** Publishes a change so /api/stream subscribers pick it up. */
export async function publishUpdate(event: Record<string, unknown>): Promise<void> {
  try {
    await redis.publish(UPDATES_CHANNEL, JSON.stringify({ ...event, at: new Date().toISOString() }));
  } catch (e: any) {
    console.error("[publishUpdate]", e.message);
  }
}
