import "./env.ts";
import { serve } from "@hono/node-server";
import { Redis } from "ioredis";
import { Pool } from "pg";

import { createApp } from "../../../core/app.ts";
import { PostgresAdapter, RedisCache } from "../../../adapters/postgres.ts";
import { streamHandler } from "./stream.ts";
import type { Bus, Ctx } from "../../../core/ports.ts";

/**
 * Self-hosted entry point (Termux, a VPS, Docker).
 *
 * Serves the same Hono router as the Cloudflare deployment, backed by Postgres
 * and Redis instead of D1 and KV. Redis also gives this build something
 * Workers cannot offer: a real SSE feed.
 */

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const redis = new Redis(process.env.REDIS_URL || "redis://localhost:6379", {
  maxRetriesPerRequest: 2,
});
// A dead cache should degrade the dashboard, not crash the process.
redis.on("error", (e) => console.error("[redis]", e.message));

export const UPDATES_CHANNEL = "dash:updates";

const bus: Bus = {
  async publish(event) {
    try {
      await redis.publish(UPDATES_CHANNEL, JSON.stringify({ ...event, at: new Date().toISOString() }));
    } catch (e: any) {
      console.error("[publish]", e.message);
    }
  },
};

const ctx: Ctx = {
  db: new PostgresAdapter(pool),
  cache: new RedisCache(redis),
  bus,
  env: process.env as Record<string, string | undefined>,
};

const app = createApp(() => ctx);

// SSE needs the raw Node response object to stream, so it is mounted here
// rather than in the shared router.
app.get("/api/stream", (c) => streamHandler(c, redis));

// The pre-Hono client called /health rather than /api/health.
app.get("/health", async (c) => {
  const res = await app.fetch(new Request(new URL("/api/health", c.req.url)));
  return c.json(await res.json(), res.status as 200);
});

const port = Number(process.env.PORT) || 4000;
serve({ fetch: app.fetch, port }, (info) => {
  console.log(`API listening on :${info.port} (postgres + redis)`);
});

export default app;
