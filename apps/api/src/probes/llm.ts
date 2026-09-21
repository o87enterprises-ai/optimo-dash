import crypto from "crypto";
import { envKey } from "../env";
import { pg, redis, publishUpdate } from "../db";
import { detectCitation } from "./citation";
import type { LlmModel, ProbeResult } from "../../../../shared/types";

/**
 * LLM visibility probe (GEO).
 *
 * Asks each enabled model a real user question and records whether the answer
 * cites the site's domain. Results land in geo_prompts, one row per
 * (site, prompt, model).
 *
 * Cost control: responses are cached in Redis for 24h keyed by
 * sha256(prompt + model), requests are serialised per provider at ~1 req/sec,
 * and 429s back off exponentially. A model with no API key is skipped, never
 * faked — visibility numbers must reflect real answers.
 */

const CACHE_TTL_SECONDS = 60 * 60 * 24;
const MIN_REQUEST_GAP_MS = 1000;
const MAX_ATTEMPTS = 4;

/** Which env var gates each model, and how to call it. */
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

/** Models whose API key is present. Everything else is greyed out in the UI. */
export function enabledModels(): LlmModel[] {
  return ALL_MODELS.filter((m) => envKey(PROVIDERS[m].envVar) !== undefined);
}

/** Per-model status for the UI's "add key to enable" affordance. */
export function modelStatus() {
  return ALL_MODELS.map((m) => ({
    name: m,
    enabled: envKey(PROVIDERS[m].envVar) !== undefined,
    reason: envKey(PROVIDERS[m].envVar) ? undefined : `${PROVIDERS[m].envVar} not set`,
  }));
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
    {
      model: "claude-3-5-sonnet-latest",
      max_tokens: 800,
      messages: [{ role: "user", content: prompt }],
    }
  );
  return (json.content ?? [])
    .filter((b: any) => b.type === "text")
    .map((b: any) => b.text)
    .join("\n");
}

async function callGemini(prompt: string, key: string): Promise<string> {
  const json = await postJson(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-pro:generateContent?key=${encodeURIComponent(key)}`,
    {},
    { contents: [{ parts: [{ text: prompt }] }] }
  );
  return (json.candidates?.[0]?.content?.parts ?? [])
    .map((p: any) => p.text ?? "")
    .join("\n");
}

async function callPerplexity(prompt: string, key: string): Promise<string> {
  const json = await postJson(
    "https://api.perplexity.ai/chat/completions",
    { Authorization: `Bearer ${key}` },
    { model: "sonar", messages: [{ role: "user", content: prompt }], max_tokens: 800 }
  );
  const text = json.choices?.[0]?.message?.content ?? "";
  // Perplexity returns its sources separately; they are exactly what a GEO
  // citation check cares about, so fold them into the searched text.
  const citations: string[] = json.citations ?? json.search_results?.map((s: any) => s.url) ?? [];
  return citations.length ? `${text}\n\nSources:\n${citations.join("\n")}` : text;
}

/* ---------- Rate limiting ---------- */

/** Last request time per provider, so calls stay serial at ~1/sec. */
const lastCallAt = new Map<LlmModel, number>();
/** In-flight chain per provider, so concurrent probes queue instead of racing. */
const queues = new Map<LlmModel, Promise<unknown>>();

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

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
  // Keep the chain alive even when this call rejects.
  queues.set(model, run.catch(() => undefined));
  return run;
}

/** Calls a provider, retrying 429s and 5xx with exponential backoff. */
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

function cacheKey(prompt: string, model: string) {
  return `geo:probe:${crypto.createHash("sha256").update(`${prompt}::${model}`).digest("hex")}`;
}

export async function probeLLM(opts: {
  siteId: number;
  prompt: string;
  models?: LlmModel[];
}): Promise<ProbeResult[]> {
  const { rows } = await pg.query("SELECT domain FROM sites WHERE id = $1", [opts.siteId]);
  if (!rows.length) throw new Error(`site ${opts.siteId} not found`);
  const domain: string = rows[0].domain;

  const requested = opts.models?.length ? opts.models : ALL_MODELS;
  const unknown = requested.filter((m) => !PROVIDERS[m]);
  if (unknown.length) throw new Error(`unknown model(s): ${unknown.join(", ")}`);

  const models = requested.filter((m) => envKey(PROVIDERS[m].envVar) !== undefined);
  if (!models.length) {
    throw new Error(
      `no models enabled — set one of ${requested.map((m) => PROVIDERS[m].envVar).join(", ")} in .env`
    );
  }

  const results: ProbeResult[] = [];

  for (const model of models) {
    let answer: string | null = null;
    let cached = false;

    try {
      const key = cacheKey(opts.prompt, model);
      const hit = await redis.get(key).catch(() => null);
      if (hit !== null) {
        answer = hit;
        cached = true;
      } else {
        answer = await callWithBackoff(model, opts.prompt, envKey(PROVIDERS[model].envVar)!);
        await redis.set(key, answer, "EX", CACHE_TTL_SECONDS).catch(() => undefined);
      }
    } catch (e: any) {
      // One dead provider must not sink the whole run.
      results.push({ model, cited: false, excerpt: "", cached: false, error: e.message });
      continue;
    }

    const { cited, excerpt } = detectCitation(answer ?? "", domain);

    await pg.query(
      `INSERT INTO geo_prompts (site_id, prompt, model, cited, excerpt, updated_at)
       VALUES ($1, $2, $3, $4, $5, NOW())
       ON CONFLICT (site_id, prompt, model)
       DO UPDATE SET cited = EXCLUDED.cited,
                     excerpt = EXCLUDED.excerpt,
                     updated_at = NOW()`,
      [opts.siteId, opts.prompt, model, cited, excerpt]
    );

    results.push({ model, cited, excerpt, cached });
  }

  await publishUpdate({ kind: "geo_prompts", siteId: opts.siteId, payload: { prompt: opts.prompt, results } });

  return results;
}
