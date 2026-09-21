import type { Ctx } from "../ports.ts";
import { now, toBool } from "../ports.ts";
import { detectCitation } from "../citation.ts";
import { getSecret } from "../secrets.ts";
import type { LlmModel, ProbeResult } from "../types";

/**
 * LLM visibility probe (GEO).
 *
 * Asks each enabled model a real user question and records whether the answer
 * cites the site's domain. Keys come from the encrypted credential store,
 * falling back to the environment, so a model is enabled the moment its key is
 * saved in the settings form — no redeploy.
 *
 * Cost control: answers are cached for 24h keyed by sha256(prompt + model),
 * requests are serialised per provider at ~1/sec, and 429s back off. A model
 * without a key is skipped, never faked.
 */

const CACHE_TTL_SECONDS = 60 * 60 * 24;
const MIN_REQUEST_GAP_MS = 1000;
const MAX_ATTEMPTS = 4;

const PROVIDERS: Record<
  LlmModel,
  { envVar: string; call: (prompt: string, key: string) => Promise<string> }
> = {
  "gpt-4o": { envVar: "OPENAI_API_KEY", call: callOpenAI },
  "claude-3.5": { envVar: "ANTHROPIC_API_KEY", call: callAnthropic },
  "gemini-1.5": { envVar: "GOOGLE_AI_API_KEY", call: callGemini },
  perplexity: { envVar: "PERPLEXITY_API_KEY", call: callPerplexity },
};

export const ALL_MODELS = Object.keys(PROVIDERS) as LlmModel[];

/** Models whose key is configured, from either source. */
export async function enabledModels(ctx: Ctx): Promise<LlmModel[]> {
  const enabled: LlmModel[] = [];
  for (const model of ALL_MODELS) {
    if (await getSecret(ctx, PROVIDERS[model].envVar)) enabled.push(model);
  }
  return enabled;
}

/** Per-model status for the UI's greyed-out cards. */
export async function modelStatus(ctx: Ctx) {
  return Promise.all(
    ALL_MODELS.map(async (name) => {
      const key = await getSecret(ctx, PROVIDERS[name].envVar);
      return {
        name,
        enabled: Boolean(key),
        reason: key ? undefined : `${PROVIDERS[name].envVar} not set`,
      };
    })
  );
}

/* ---------- Provider adapters ---------- */

async function postJson(url: string, headers: Record<string, string>, body: unknown) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    const err: any = new Error(`${res.status} ${res.statusText} ${text.slice(0, 300)}`);
    err.status = res.status;
    throw err;
  }
  return res.json() as Promise<any>;
}

async function callOpenAI(prompt: string, key: string): Promise<string> {
  const json = await postJson(
    "https://api.openai.com/v1/chat/completions",
    { Authorization: `Bearer ${key}` },
    { model: "gpt-4o", messages: [{ role: "user", content: prompt }], max_tokens: 800 }
  );
  return json.choices?.[0]?.message?.content ?? "";
}

async function callAnthropic(prompt: string, key: string): Promise<string> {
  const json = await postJson(
    "https://api.anthropic.com/v1/messages",
    { "x-api-key": key, "anthropic-version": "2023-06-01" },
    { model: "claude-3-5-sonnet-latest", max_tokens: 800, messages: [{ role: "user", content: prompt }] }
  );
  return (json.content ?? []).filter((b: any) => b.type === "text").map((b: any) => b.text).join("\n");
}

async function callGemini(prompt: string, key: string): Promise<string> {
  const json = await postJson(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-pro:generateContent?key=${encodeURIComponent(key)}`,
    {},
    { contents: [{ parts: [{ text: prompt }] }] }
  );
  return (json.candidates?.[0]?.content?.parts ?? []).map((p: any) => p.text ?? "").join("\n");
}

async function callPerplexity(prompt: string, key: string): Promise<string> {
  const json = await postJson(
    "https://api.perplexity.ai/chat/completions",
    { Authorization: `Bearer ${key}` },
    { model: "sonar", messages: [{ role: "user", content: prompt }], max_tokens: 800 }
  );
  const text = json.choices?.[0]?.message?.content ?? "";
  // Perplexity returns sources separately; they are exactly what a citation
  // check cares about, so fold them into the searched text.
  const citations: string[] = json.citations ?? json.search_results?.map((s: any) => s.url) ?? [];
  return citations.length ? `${text}\n\nSources:\n${citations.join("\n")}` : text;
}

/* ---------- Rate limiting ---------- */

const lastCallAt = new Map<LlmModel, number>();
const queues = new Map<LlmModel, Promise<unknown>>();

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Runs fn after the provider's queue drains and its 1 req/sec gap has passed. */
function enqueue<T>(model: LlmModel, fn: () => Promise<T>): Promise<T> {
  const run = (queues.get(model) ?? Promise.resolve()).then(async () => {
    const gap = Date.now() - (lastCallAt.get(model) ?? 0);
    if (gap < MIN_REQUEST_GAP_MS) await sleep(MIN_REQUEST_GAP_MS - gap);
    try {
      return await fn();
    } finally {
      lastCallAt.set(model, Date.now());
    }
  });
  queues.set(model, run.catch(() => undefined));
  return run;
}

async function callWithBackoff(model: LlmModel, prompt: string, key: string): Promise<string> {
  let lastErr: any;
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    try {
      return await enqueue(model, () => PROVIDERS[model].call(prompt, key));
    } catch (e: any) {
      lastErr = e;
      const retryable = e.status === 429 || (e.status >= 500 && e.status < 600) || !e.status;
      if (!retryable || attempt === MAX_ATTEMPTS - 1) break;
      await sleep(1000 * 2 ** attempt);
    }
  }
  throw lastErr;
}

/* ---------- Probe ---------- */

async function cacheKey(prompt: string, model: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`${prompt}::${model}`));
  const hex = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
  return `geo:probe:${hex}`;
}

export async function probeLLM(
  ctx: Ctx,
  opts: { siteId: number; prompt: string; models?: LlmModel[] }
): Promise<ProbeResult[]> {
  const site = await ctx.db.first<{ domain: string }>("SELECT domain FROM sites WHERE id = ?", [
    opts.siteId,
  ]);
  if (!site) throw new Error(`site ${opts.siteId} not found`);

  const requested = opts.models?.length ? opts.models : ALL_MODELS;
  const unknown = requested.filter((m) => !PROVIDERS[m]);
  if (unknown.length) throw new Error(`unknown model(s): ${unknown.join(", ")}`);

  const keys = new Map<LlmModel, string>();
  for (const model of requested) {
    const key = await getSecret(ctx, PROVIDERS[model].envVar);
    if (key) keys.set(model, key);
  }
  if (!keys.size) {
    throw new Error(
      `no models enabled — add a key in Settings, or set one of ${requested
        .map((m) => PROVIDERS[m].envVar)
        .join(", ")}`
    );
  }

  const results: ProbeResult[] = [];

  for (const [model, key] of keys) {
    let answer: string;
    let cached = false;

    try {
      const cacheId = await cacheKey(opts.prompt, model);
      const hit = await ctx.cache.get(cacheId);
      if (hit !== null) {
        answer = hit;
        cached = true;
      } else {
        answer = await callWithBackoff(model, opts.prompt, key);
        await ctx.cache.set(cacheId, answer, CACHE_TTL_SECONDS);
      }
    } catch (e: any) {
      // One dead provider must not sink the whole run.
      results.push({ model, cited: false, excerpt: "", cached: false, error: e.message });
      continue;
    }

    const { cited, excerpt } = detectCitation(answer, site.domain);

    await ctx.db.run(
      `INSERT INTO geo_prompts (site_id, prompt, model, cited, excerpt, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT (site_id, prompt, model)
       DO UPDATE SET cited = excluded.cited, excerpt = excluded.excerpt, updated_at = excluded.updated_at`,
      [opts.siteId, opts.prompt, model, cited ? 1 : 0, excerpt, now()]
    );

    results.push({ model, cited, excerpt, cached });
  }

  await ctx.bus.publish({ kind: "geo_prompts", siteId: opts.siteId, payload: { prompt: opts.prompt, results } });
  return results;
}

/** Prompts and visibility for a site, with a per-model breakdown. */
export async function getGeo(ctx: Ctx, siteId: number) {
  const rows = await ctx.db.all<any>(
    "SELECT * FROM geo_prompts WHERE site_id = ? ORDER BY updated_at DESC LIMIT 200",
    [siteId]
  );
  const prompts = rows.map((r) => ({ ...r, cited: toBool(r.cited) }));
  const cited = prompts.filter((p) => p.cited).length;

  const byModel: Record<string, { total: number; cited: number; visibility: number }> = {};
  for (const p of prompts) {
    byModel[p.model] ??= { total: 0, cited: 0, visibility: 0 };
    byModel[p.model].total++;
    if (p.cited) byModel[p.model].cited++;
  }
  for (const m of Object.values(byModel)) {
    m.visibility = m.total ? Math.round((m.cited / m.total) * 100) : 0;
  }

  return {
    prompts,
    visibility: prompts.length ? Math.round((cited / prompts.length) * 100) : 0,
    byModel,
    models: await modelStatus(ctx),
  };
}
