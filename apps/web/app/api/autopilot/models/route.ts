import { AiError, listModels, pickProvider } from "../../../../lib/autopilot/server";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

// Lists the models a provider currently offers (so a retired default can be replaced).
export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  try {
    const provider = pickProvider(req, { ...body, model: undefined });
    if (!provider) throw new AiError(400, "Pick a provider first.");
    return Response.json({ ok: true, provider: provider.id, current: provider.model ?? null, models: await listModels(provider) });
  } catch (e: any) {
    const status = e instanceof AiError ? e.status : 502;
    return Response.json({ ok: false, error: String(e.message ?? e).slice(0, 300) }, { status });
  }
}
