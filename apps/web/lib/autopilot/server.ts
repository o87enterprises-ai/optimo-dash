// Server-side AI access for the autopilot. Reuses the provider-agnostic layer shared with the GEO probes
// (NVIDIA, Groq, Gemini, Ollama, any OpenAI-compatible endpoint), so any free key works.
import { listProviders, Provider, ProviderStatus, resolveProvider } from "@llm/providers";
import { briefError } from "./fallback";

/** Providers a visitor may bring their own key for. The base URL always comes from the server, never the request. */
const BYOK = new Set(["nvidia", "groq", "gemini", "ollama-cloud"]);

export type KeyAccess = "open" | "code" | "off";

/**
 * Whether keys configured on the server may be used:
 *  - open: local dev, nothing set
 *  - code: AUTOPILOT_ACCESS_KEY is set and the request must send it
 *  - off:  deployed without an access code, so only keys the visitor pastes in are used
 */
export function keyAccess(): KeyAccess {
  if (process.env.AUTOPILOT_ACCESS_KEY) return "code";
  return process.env.VERCEL ? "off" : "open";
}

export function serverKeysAllowed(req: Request): boolean {
  const mode = keyAccess();
  if (mode === "open") return true;
  if (mode === "off") return false;
  return req.headers.get("x-autopilot-access") === process.env.AUTOPILOT_ACCESS_KEY;
}

function visibleProviders(req: Request): Provider[] {
  const all = listProviders();
  if (serverKeysAllowed(req)) return all;
  return all.filter((p) => BYOK.has(p.id)).map((p) => ({ ...p, apiKey: undefined }));
}

export async function statuses(req: Request): Promise<{ providers: ProviderStatus[]; access: KeyAccess; serverKeys: boolean }> {
  const providers = await Promise.all(
    visibleProviders(req).map(async (p) => {
      const s = await resolveProvider(p);
      return !s.enabled && p.keyRequired && !p.apiKey ? { ...s, reason: "add a key to enable" } : s;
    })
  );
  return { providers, access: keyAccess(), serverKeys: serverKeysAllowed(req) };
}

export class AiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

const MODEL_ID = /^[\w./:@+-]{1,120}$/;

/** The provider a request names (with the visitor's own key and model applied), without checking it is ready. */
export function pickProvider(req: Request, body: { provider?: unknown; apiKey?: unknown; model?: unknown }): Provider | undefined {
  const list = visibleProviders(req);
  let chosen: Provider | undefined;

  if (typeof body.provider === "string" && body.provider) {
    chosen = list.find((p) => p.id === body.provider);
    if (!chosen) throw new AiError(400, `Unknown provider "${body.provider}".`);
  }
  if (typeof body.apiKey === "string" && body.apiKey) {
    if (!chosen || !BYOK.has(chosen.id)) throw new AiError(400, "Pick a provider to use with that key.");
    if (body.apiKey.length > 300 || /\s/.test(body.apiKey)) throw new AiError(400, "That key does not look right.");
    chosen = { ...chosen, apiKey: body.apiKey };
  }
  if (typeof body.model === "string" && body.model && chosen) {
    if (!MODEL_ID.test(body.model)) throw new AiError(400, "That model name does not look right.");
    chosen = { ...chosen, model: body.model };
  }
  return chosen;
}

export type Ready = { provider: Provider; model: string; status: ProviderStatus };

/** One provider that is ready to use: the one requested, or the first ready one. */
export async function selectProvider(req: Request, body: { provider?: unknown; apiKey?: unknown; model?: unknown }): Promise<Ready> {
  const chosen = pickProvider(req, body);
  if (chosen) {
    const status = await resolveProvider(chosen);
    if (!status.enabled) throw new AiError(409, `${chosen.label} is not ready: ${status.reason ?? "unavailable"}.`);
    return { provider: chosen, model: status.model!, status };
  }
  const all = await readyProviders(req);
  if (!all.length) throw new AiError(409, "No AI provider is available. Add a free key for NVIDIA, Groq or Gemini.");
  return all[0];
}

/** Every provider that is ready, in order. */
export async function readyProviders(req: Request): Promise<Ready[]> {
  const out: Ready[] = [];
  for (const provider of visibleProviders(req)) {
    const status = await resolveProvider(provider);
    if (status.enabled) out.push({ provider, model: status.model!, status });
  }
  // hosted providers answer fastest, so local models are the last resort
  return [...out.filter((r) => !r.provider.local), ...out.filter((r) => r.provider.local)];
}

/** What to try, in order: just the requested provider, or every ready one so a failing one can be skipped. */
export async function candidates(req: Request, body: { provider?: unknown; apiKey?: unknown; model?: unknown }): Promise<Ready[]> {
  if (pickProvider(req, body)) return [await selectProvider(req, body)];
  const all = await readyProviders(req);
  if (!all.length) throw new AiError(409, "No AI provider is available. Add a free key for NVIDIA, Groq or Gemini.");
  return all;
}

const NOT_CHAT = /embed|rerank|reward|whisper|tts|moderation|guard|image|clip|vision|speech|asr/i;

/** The models a provider currently offers, so a retired default can be swapped for a live one. */
export async function listModels(p: Provider): Promise<string[]> {
  if (p.keyRequired && !p.apiKey) throw new AiError(409, `${p.label} needs a key first.`);
  const gemini = p.kind === "gemini";
  const url = gemini ? `${p.baseUrl}/models?pageSize=200` : `${p.baseUrl}/models`;
  const headers: Record<string, string> = gemini ? { "x-goog-api-key": p.apiKey! } : p.apiKey ? { Authorization: `Bearer ${p.apiKey}` } : {};
  const res = await fetch(url, { headers, signal: AbortSignal.timeout(12_000) });
  if (!res.ok) throw new AiError(502, `${p.label}: ${briefError(`HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`)}`);
  const body: any = await res.json();
  const names: string[] = gemini
    ? (body.models ?? []).filter((m: any) => m.supportedGenerationMethods?.includes("generateContent")).map((m: any) => String(m.name).replace(/^models\//, ""))
    : (body.data ?? body.models ?? []).map((m: any) => String(m.id ?? m.name ?? m.model));
  return [...new Set(names)].filter((n) => n && !NOT_CHAT.test(n)).sort().slice(0, 300);
}
