import { createApp } from "../../core/app.ts";
import { D1Adapter, KvCache } from "../../adapters/d1.ts";
import type { Bus, Cache, Ctx } from "../../core/ports.ts";

/**
 * Cloudflare Pages Function serving the whole API.
 *
 * Pages routes every /api/* request here; Hono does the rest. Bindings are
 * declared in wrangler.toml.
 */

type Env = {
  DB: any;
  CACHE?: any;
  ENCRYPTION_KEY?: string;
  [key: string]: unknown;
};

// The router is built once per isolate; the context is rebuilt per request
// from that request's bindings.
const app = createApp((c) => (c.env as { ctx: Ctx }).ctx);

/**
 * Cache fallback for deployments without a KV binding. Per-isolate and
 * short-lived, so probes still work — they just re-query an LLM more often.
 */
class MemoryCache implements Cache {
  private store = new Map<string, { value: string; expires: number }>();

  async get(key: string): Promise<string | null> {
    const hit = this.store.get(key);
    if (!hit) return null;
    if (hit.expires < Date.now()) {
      this.store.delete(key);
      return null;
    }
    return hit.value;
  }

  async set(key: string, value: string, ttlSeconds: number): Promise<void> {
    this.store.set(key, { value, expires: Date.now() + ttlSeconds * 1000 });
  }

  async delete(key: string): Promise<void> {
    this.store.delete(key);
  }
}

/**
 * Live updates are a no-op on Workers: there is no shared pub/sub between
 * isolates, and holding an SSE connection open per client would pin a
 * Durable Object. The client polls instead.
 */
const noopBus: Bus = { publish: async () => undefined };

export const onRequest = async (context: { request: Request; env: Env }) => {
  const { request, env } = context;

  if (!env.DB) {
    return Response.json(
      { error: "D1 binding 'DB' is missing — check wrangler.toml and the Pages project bindings" },
      { status: 503 }
    );
  }

  const ctx: Ctx = {
    db: new D1Adapter(env.DB),
    cache: env.CACHE ? new KvCache(env.CACHE) : new MemoryCache(),
    bus: noopBus,
    // Bindings arrive as properties on env; expose them as a plain record so
    // core code reads configuration the same way on both runtimes.
    env: env as unknown as Record<string, string | undefined>,
  };

  return app.fetch(request, { ctx });
};
