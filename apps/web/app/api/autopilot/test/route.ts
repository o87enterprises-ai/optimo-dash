import { ask } from "@llm/providers";
import { AiError, selectProvider } from "../../../../lib/autopilot/server";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Connection check: one tiny request so a new key can be verified end to end.
export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  try {
    const { provider, model } = await selectProvider(req, body);
    const t0 = Date.now();
    const a = await ask(provider, model, "Reply with exactly the word OK.", { grounded: false, maxTokens: 20, temperature: 0 });
    return Response.json({ ok: true, provider: provider.id, model, ms: Date.now() - t0, reply: a.text.trim().slice(0, 80) });
  } catch (e: any) {
    const status = e instanceof AiError ? e.status : 502;
    return Response.json({ ok: false, error: String(e.message ?? e).slice(0, 300) }, { status });
  }
}
