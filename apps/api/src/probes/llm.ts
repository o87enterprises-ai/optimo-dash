import { createHash } from "crypto";
import type Redis from "ioredis";
import type { Pool } from "pg";
import { Answer, ask, listProviders, resolveProvider } from "./providers";

export interface ProbeResult {
  provider: string;
  model: string;
  /** brand or domain appears in the answer text (every provider) */
  mentioned: boolean;
  /** domain appears in the provider's reported sources (grounded providers only) */
  cited: boolean;
  excerpt: string;
  sources: { url: string; title?: string }[] | null;
  cached: boolean;
  error?: string;
}

export class NoProviderError extends Error {}

const CACHE_TTL_S = 24 * 60 * 60;
const REMOTE_MIN_INTERVAL_MS = 1000;

/* ---------- detection ---------- */

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const bare = (d: string) => d.toLowerCase().replace(/^www\./, "");

export function findMention(text: string, domain: string, name?: string | null): string | null {
  const terms = [bare(domain)];
  if (name && name.length >= 3 && bare(name) !== bare(domain)) terms.push(name.toLowerCase());
  const lower = text.toLowerCase();
  for (const term of terms) {
    const m = new RegExp(`(^|[^a-z0-9])${escapeRe(term)}(?![a-z0-9])`).exec(lower);
    if (m) {
      const at = m.index + m[1].length;
      return text.slice(Math.max(0, at - 200), at + term.length + 200).trim();
    }
  }
  return null;
}

function sourceHitsDomain(sources: Answer["sources"], domain: string): boolean {
  if (!sources) return false;
  const d = bare(domain);
  return sources.some((s) => {
    const hay = `${s.url} ${s.title ?? ""}`.toLowerCase();
    return new RegExp(`(^|[^a-z0-9])(www\\.)?${escapeRe(d)}(?![a-z0-9])`).test(hay);
  });
}

/* ---------- per-provider serial queue (~1 req/sec for remote APIs) ---------- */

const lanes = new Map<string, Promise<unknown>>();

function inLane<T>(id: string, local: boolean, fn: () => Promise<T>): Promise<T> {
  const prev = lanes.get(id) ?? Promise.resolve();
  const run = prev.then(async () => {
    try {
      return await fn();
    } finally {
      if (!local) await new Promise((r) => setTimeout(r, REMOTE_MIN_INTERVAL_MS));
    }
  });
  lanes.set(id, run.catch(() => undefined));
  return run;
}

/* ---------- probe ---------- */

export async function probeLLM(
  deps: { pg: Pool; redis: Redis },
  opts: { siteId: number; prompt: string; providers?: string[] }
): Promise<ProbeResult[]> {
  const { pg, redis } = deps;
  const site = (await pg.query("SELECT domain, name FROM sites WHERE id = $1", [opts.siteId])).rows[0];
  if (!site) throw new Error("site not found");

  const wanted = opts.providers?.length ? new Set(opts.providers) : null;
  const candidates = listProviders().filter((p) => !wanted || wanted.has(p.id));
  const resolved = await Promise.all(candidates.map(async (p) => ({ p, s: await resolveProvider(p) })));
  const active = resolved.filter((x) => x.s.enabled && x.s.model);
  if (!active.length) {
    throw new NoProviderError(
      "No enabled LLM provider. " +
        resolved.map((x) => `${x.s.id}: ${x.s.reason ?? "unavailable"}`).join("; ")
    );
  }

  return Promise.all(
    active.map(async ({ p, s }): Promise<ProbeResult> => {
      const model = s.model!;
      const cacheKey = "probe:" + createHash("sha256").update(`${p.id}|${model}|${opts.prompt}`).digest("hex");
      try {
        let cached = false;
        let answer: Answer;
        const hit = await redis.get(cacheKey);
        if (hit) {
          answer = JSON.parse(hit);
          cached = true;
        } else {
          answer = await inLane(p.id, !!p.local, () => ask(p, model, opts.prompt));
          await redis.set(cacheKey, JSON.stringify(answer), "EX", CACHE_TTL_S);
        }

        const excerpt = findMention(answer.text, site.domain, site.name);
        const mentioned = excerpt !== null;
        const cited = sourceHitsDomain(answer.sources, site.domain);

        await pg.query(
          `INSERT INTO geo_prompts (site_id, prompt, model, provider, cited, mentioned, excerpt, sources)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
          [
            opts.siteId,
            opts.prompt,
            model,
            p.id,
            cited,
            mentioned,
            excerpt ?? "",
            answer.sources ? JSON.stringify(answer.sources) : null,
          ]
        );
        return { provider: p.id, model, mentioned, cited, excerpt: excerpt ?? "", sources: answer.sources, cached };
      } catch (e: any) {
        return {
          provider: p.id, model, mentioned: false, cited: false, excerpt: "",
          sources: null, cached: false, error: e.message ?? String(e),
        };
      }
    })
  );
}
