// Server-side AI access for the autopilot. Reuses the provider-agnostic layer shared with the GEO probes
// (NVIDIA, Groq, Gemini, Ollama, any OpenAI-compatible endpoint), so any free key works.
import { listProviders, Provider, ProviderStatus, resolveProvider } from "@llm/providers";

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

export async function selectProvider(
  req: Request,
  body: { provider?: unknown; apiKey?: unknown }
): Promise<{ provider: Provider; model: string; status: ProviderStatus }> {
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

  if (chosen) {
    const status = await resolveProvider(chosen);
    if (!status.enabled) throw new AiError(409, `${chosen.label} is not ready: ${status.reason ?? "unavailable"}.`);
    return { provider: chosen, model: status.model!, status };
  }
  for (const p of list) {
    const status = await resolveProvider(p);
    if (status.enabled) return { provider: p, model: status.model!, status };
  }
  throw new AiError(409, "No AI provider is available. Add a free key for NVIDIA, Groq or Gemini.");
}
