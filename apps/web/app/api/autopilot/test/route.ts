import { ask } from "@llm/providers";
import { briefError } from "../../../../lib/autopilot/fallback";
import { AiError, candidates } from "../../../../lib/autopilot/server";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const TEST_LIMIT_S = 40;

// Connection check: one tiny request per provider, so a new key (or a retired model) shows up right away.
// With no provider chosen it tests every ready provider.
export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  try {
    const list = await candidates(req, body);
    const results = await Promise.all(
      list.map(async ({ provider, model }) => {
        const t0 = Date.now();
        try {
          const a = await Promise.race([
            ask(provider, model, "Reply with exactly the word OK.", { grounded: false, maxTokens: 20, temperature: 0 }),
            new Promise<never>((_, reject) =>
              setTimeout(() => reject(new Error(`no answer in ${TEST_LIMIT_S} s${provider.local ? " (local models can be slow to load; try again once it is warm)" : ""}`)), TEST_LIMIT_S * 1000)
            ),
          ]);
          return { provider: provider.id, label: provider.label, model, ok: true, ms: Date.now() - t0, reply: a.text.trim().slice(0, 80) };
        } catch (e: any) {
          return { provider: provider.id, label: provider.label, model, ok: false, ms: Date.now() - t0, error: briefError(String(e.message ?? e)) };
        }
      })
    );
    return Response.json({ ok: results.some((r) => r.ok), results });
  } catch (e: any) {
    const status = e instanceof AiError ? e.status : 502;
    return Response.json({ ok: false, error: String(e.message ?? e).slice(0, 300) }, { status });
  }
}
