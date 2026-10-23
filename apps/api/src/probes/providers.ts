/**
 * Provider-agnostic LLM access.
 *
 * Two adapter kinds cover everything:
 *   - "openai": any OpenAI-compatible /chat/completions endpoint
 *               (NVIDIA, Groq, Ollama local + cloud, OpenRouter, LM Studio, vLLM, ...)
 *   - "gemini": Google Generative Language API, with optional Google Search grounding
 *
 * Built-in presets are enabled by env vars. Add any other OpenAI-compatible
 * provider with no code change:
 *   LLM_PROVIDER_<NAME>_BASE_URL=https://host/v1
 *   LLM_PROVIDER_<NAME>_MODEL=some-model
 *   LLM_PROVIDER_<NAME>_API_KEY=optional
 */

export type ProviderKind = "openai" | "gemini";

export interface Provider {
  id: string;
  label: string;
  kind: ProviderKind;
  baseUrl: string;
  apiKey?: string;
  model?: string;
  /** false → usable without a key (local servers, custom endpoints) */
  keyRequired: boolean;
  /** local providers skip the per-provider request spacing and get a longer timeout */
  local?: boolean;
  /** Ollama-style local server: discover pulled models via /api/tags */
  discoverOllama?: boolean;
}

export interface ProviderStatus {
  id: string;
  label: string;
  kind: ProviderKind;
  model: string | null;
  enabled: boolean;
  grounded: boolean;
  reason?: string;
}

export interface Answer {
  text: string;
  /** null = provider cannot report sources; [] = grounded but cited nothing */
  sources: { url: string; title?: string }[] | null;
}

type Env = NodeJS.ProcessEnv;

const trimSlash = (s: string) => s.replace(/\/+$/, "");

export function listProviders(env: Env = process.env): Provider[] {
  const out: Provider[] = [
    {
      id: "nvidia",
      label: "NVIDIA",
      kind: "openai",
      baseUrl: trimSlash(env.NVIDIA_BASE_URL || "https://integrate.api.nvidia.com/v1"),
      apiKey: env.NVIDIA_API_KEY,
      model: env.NVIDIA_MODEL || "meta/llama-3.1-8b-instruct",
      keyRequired: true,
    },
    {
      id: "groq",
      label: "Groq",
      kind: "openai",
      baseUrl: trimSlash(env.GROQ_BASE_URL || "https://api.groq.com/openai/v1"),
      apiKey: env.GROQ_API_KEY,
      model: env.GROQ_MODEL || "llama-3.1-8b-instant",
      keyRequired: true,
    },
    {
      id: "gemini",
      label: "Gemini",
      kind: "gemini",
      baseUrl: trimSlash(env.GEMINI_BASE_URL || "https://generativelanguage.googleapis.com/v1beta"),
      apiKey: env.GOOGLE_AI_API_KEY || env.GEMINI_API_KEY,
      model: env.GEMINI_MODEL || "gemini-2.0-flash",
      keyRequired: true,
    },
    {
      id: "ollama",
      label: "Ollama (local)",
      kind: "openai",
      baseUrl: `${trimSlash(env.OLLAMA_BASE_URL || "http://localhost:11434")}/v1`,
      model: env.OLLAMA_MODEL, // optional: otherwise the first pulled model is used
      keyRequired: false,
      local: true,
      discoverOllama: true,
    },
    {
      id: "ollama-cloud",
      label: "Ollama (cloud)",
      kind: "openai",
      baseUrl: trimSlash(env.OLLAMA_CLOUD_BASE_URL || "https://ollama.com/v1"),
      apiKey: env.OLLAMA_CLOUD_API_KEY,
      model: env.OLLAMA_CLOUD_MODEL,
      keyRequired: true,
    },
  ];

  // Generic OpenAI-compatible providers: LLM_PROVIDER_<NAME>_BASE_URL
  for (const key of Object.keys(env)) {
    const m = key.match(/^LLM_PROVIDER_([A-Z0-9_]+)_BASE_URL$/);
    if (!m || !env[key]) continue;
    const name = m[1];
    out.push({
      id: name.toLowerCase().replace(/_/g, "-"),
      label: name,
      kind: "openai",
      baseUrl: trimSlash(env[key]!),
      apiKey: env[`LLM_PROVIDER_${name}_API_KEY`],
      model: env[`LLM_PROVIDER_${name}_MODEL`],
      keyRequired: false,
    });
  }
  return out;
}

const groundingOn = (env: Env = process.env) => env.GEMINI_GROUNDING !== "false";

/** Work out whether a provider is usable right now, and with which model. */
export async function resolveProvider(p: Provider): Promise<ProviderStatus> {
  const base = {
    id: p.id,
    label: p.label,
    kind: p.kind,
    grounded: p.kind === "gemini" && groundingOn(),
  };

  if (p.keyRequired && !p.apiKey) {
    return { ...base, model: p.model ?? null, enabled: false, reason: "add API key to enable" };
  }

  if (p.discoverOllama) {
    const root = p.baseUrl.replace(/\/v1$/, "");
    try {
      const r = await fetch(`${root}/api/tags`, { signal: AbortSignal.timeout(1500) });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const tags = ((await r.json()) as any).models as { name: string }[] | undefined;
      const names = (tags ?? []).map((m) => m.name);
      if (!names.length) {
        return { ...base, model: null, enabled: false, reason: "no models pulled yet (ollama pull <model>)" };
      }
      if (p.model) {
        const hit = names.find((n) => n === p.model || n.split(":")[0] === p.model);
        if (!hit) return { ...base, model: p.model, enabled: false, reason: `model "${p.model}" not pulled` };
        return { ...base, model: hit, enabled: true };
      }
      return { ...base, model: names[0], enabled: true };
    } catch {
      return { ...base, model: p.model ?? null, enabled: false, reason: `not reachable at ${root}` };
    }
  }

  if (!p.model) {
    return { ...base, model: null, enabled: false, reason: "set a model for this provider" };
  }
  return { ...base, model: p.model, enabled: true };
}

export async function resolveProviders(): Promise<ProviderStatus[]> {
  return Promise.all(listProviders().map(resolveProvider));
}

/* ---------- HTTP with backoff ---------- */

class HttpError extends Error {
  constructor(public status: number, message: string, public retryAfterMs?: number) {
    super(message);
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function postJson(
  url: string,
  headers: Record<string, string>,
  body: unknown,
  timeoutMs: number
): Promise<any> {
  const maxAttempts = 4;
  for (let attempt = 0; ; attempt++) {
    try {
      const r = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...headers },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (r.ok) return await r.json();
      const detail = (await r.text()).slice(0, 300);
      const ra = Number(r.headers.get("retry-after"));
      throw new HttpError(r.status, `HTTP ${r.status}: ${detail}`, ra > 0 ? ra * 1000 : undefined);
    } catch (e: any) {
      const retriable = e instanceof HttpError ? e.status === 429 || e.status >= 500 : true;
      if (!retriable || attempt >= maxAttempts - 1) throw e;
      const backoff = e instanceof HttpError && e.retryAfterMs ? e.retryAfterMs : 1000 * 2 ** (attempt + 1);
      await sleep(Math.min(backoff, 30_000));
    }
  }
}

/* ---------- Adapters ---------- */

export interface AskOptions {
  /** instructions kept separate from the user prompt */
  system?: string;
  /** Gemini only: override Google Search grounding (default: the GEMINI_GROUNDING setting) */
  grounded?: boolean;
  temperature?: number;
  maxTokens?: number;
}

export async function ask(p: Provider, model: string, prompt: string, opts: AskOptions = {}): Promise<Answer> {
  const timeout = p.local ? 180_000 : 60_000;

  if (p.kind === "gemini") {
    const body: any = { contents: [{ role: "user", parts: [{ text: prompt }] }] };
    if (opts.system) body.systemInstruction = { parts: [{ text: opts.system }] };
    if (opts.temperature !== undefined || opts.maxTokens !== undefined) {
      body.generationConfig = { temperature: opts.temperature, maxOutputTokens: opts.maxTokens };
    }
    const grounded = opts.grounded ?? groundingOn();
    if (grounded) body.tools = [{ google_search: {} }];
    const data = await postJson(
      `${p.baseUrl}/models/${model}:generateContent`,
      { "x-goog-api-key": p.apiKey! },
      body,
      timeout
    );
    const cand = data.candidates?.[0];
    const text = (cand?.content?.parts ?? []).map((x: any) => x.text ?? "").join("");
    const chunks: any[] = cand?.groundingMetadata?.groundingChunks ?? [];
    const sources = grounded
      ? chunks.filter((c) => c.web?.uri).map((c) => ({ url: c.web.uri as string, title: c.web.title as string | undefined }))
      : null;
    return { text, sources };
  }

  const headers: Record<string, string> = p.apiKey ? { Authorization: `Bearer ${p.apiKey}` } : {};
  const data = await postJson(
    `${p.baseUrl}/chat/completions`,
    headers,
    {
      model,
      messages: [...(opts.system ? [{ role: "system", content: opts.system }] : []), { role: "user", content: prompt }],
      temperature: opts.temperature ?? 0.2,
      max_tokens: opts.maxTokens ?? 700,
    },
    timeout
  );
  return { text: data.choices?.[0]?.message?.content ?? "", sources: null };
}
