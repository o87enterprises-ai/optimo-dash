import { ask } from "@llm/providers";
import { buildCopyPrompt, checkCopy, COPY_SYSTEM, CopyRequest, CopyResult } from "../../../../lib/autopilot/ai";
import { LIMITS } from "../../../../lib/autopilot/rules";
import { AiError, selectProvider } from "../../../../lib/autopilot/server";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const str = (v: unknown, max: number) => (typeof v === "string" ? v.slice(0, max) : null);

function clean(raw: any): CopyRequest | null {
  const path = str(raw?.path, 300);
  const wants = Array.isArray(raw?.wants) ? raw.wants.filter((w: unknown) => w === "title" || w === "description") : [];
  if (!path || !wants.length) return null;
  return {
    path,
    siteName: str(raw.siteName, 120),
    wants,
    context: {
      h1: str(raw.context?.h1, 300),
      title: str(raw.context?.title, 300),
      description: str(raw.context?.description, 500),
      excerpt: str(raw.context?.excerpt, 900),
    },
  };
}

// Drafts search-result copy with whichever AI provider is available. Output is validated before it is returned;
// anything rejected comes back as an error so the caller keeps the built-in copy.
export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const pages = (Array.isArray(body.pages) ? body.pages : []).map(clean).filter(Boolean) as CopyRequest[];
  if (!pages.length) return Response.json({ error: "No pages to write copy for." }, { status: 400 });
  if (pages.length > LIMITS.maxPagesPerRun) {
    return Response.json({ error: `At most ${LIMITS.maxPagesPerRun} pages per run.` }, { status: 422 });
  }
  try {
    const { provider, model } = await selectProvider(req, body);
    const results: CopyResult[] = [];
    for (const page of pages) {
      try {
        const a = await ask(provider, model, buildCopyPrompt(page), { system: COPY_SYSTEM, grounded: false, temperature: 0.3, maxTokens: 400 });
        results.push(checkCopy(page, a.text));
      } catch (e: any) {
        results.push({ path: page.path, error: String(e.message ?? e).slice(0, 200) });
      }
    }
    return Response.json({ provider: provider.id, model, results });
  } catch (e: any) {
    const status = e instanceof AiError ? e.status : 502;
    return Response.json({ error: String(e.message ?? e).slice(0, 300) }, { status });
  }
}
