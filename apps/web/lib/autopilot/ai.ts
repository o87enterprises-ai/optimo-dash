import { FieldEdit, LIMITS, PageContext, PageProposal, validateCopy } from "./rules";

export type CopyRequest = {
  path: string;
  siteName: string | null;
  context: PageContext;
  wants: ("title" | "description")[];
};

export type CopyResult = { path: string; title?: string; description?: string; error?: string; provider?: string };

export const COPY_SYSTEM =
  "You write search-result metadata for a web page. Reply with one JSON object and nothing else. " +
  "Use only facts that appear in the page content you are given. Never invent numbers, prices, " +
  "awards, locations or claims. Plain, specific language; no clickbait, no ALL CAPS, no emoji. " +
  "Write in the same language as the page.";

export function buildCopyPrompt(r: CopyRequest): string {
  const lines = [
    `Page: ${r.path}`,
    r.siteName ? `Site name: ${r.siteName}` : null,
    r.context.h1 ? `Main heading: ${r.context.h1}` : null,
    r.context.title ? `Current title: ${r.context.title}` : null,
    r.context.description ? `Current description: ${r.context.description}` : null,
    r.context.excerpt ? `Page text:\n${r.context.excerpt}` : null,
    "",
    "Return JSON with these keys only: " + r.wants.map((w) => `"${w}"`).join(", ") + ".",
    r.wants.includes("title") ? `"title": ${LIMITS.titleMin}-${LIMITS.titleMax} characters, says what the page is, ends with the site name after " | " when it fits.` : null,
    r.wants.includes("description") ? `"description": ${LIMITS.descMin + 40}-${LIMITS.descTarget} characters, a helpful summary that makes someone want to click.` : null,
  ];
  return lines.filter((l) => l !== null).join("\n");
}

/** Pull the first JSON object out of a model reply, tolerating code fences and chatter. */
export function parseCopyJson(text: string): Record<string, unknown> | null {
  const cleaned = text.replace(/```(?:json)?/gi, "");
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    const v = JSON.parse(cleaned.slice(start, end + 1));
    return v && typeof v === "object" ? v : null;
  } catch {
    return null;
  }
}

/** Source text an AI suggestion is allowed to draw facts from. */
export const factSource = (r: CopyRequest) =>
  [r.path, r.siteName, r.context.h1, r.context.title, r.context.description, r.context.excerpt].filter(Boolean).join(" ");

export function checkCopy(r: CopyRequest, raw: string): CopyResult {
  const json = parseCopyJson(raw);
  if (!json) return { path: r.path, error: "the model did not return JSON" };
  const out: CopyResult = { path: r.path };
  const problems: string[] = [];
  for (const w of r.wants) {
    const v = json[w];
    if (typeof v !== "string") { problems.push(`${w} missing`); continue; }
    const bad = validateCopy(w, v, factSource(r));
    if (bad) problems.push(`${w}: ${bad}`);
    else out[w] = v.replace(/\s+/g, " ").trim();
  }
  if (problems.length) out.error = problems.join("; ");
  return out;
}

/** Fold validated AI copy into proposals. Anything rejected keeps the built-in rules copy. */
export function mergeAiCopy(proposals: PageProposal[], results: CopyResult[], fallbackProvider = "ai"): PageProposal[] {
  return proposals.map((p) => {
    const res = results.find((r) => r.path === p.path);
    if (!res) return p;
    const providerId = res.provider ?? fallbackProvider;
    let title = p.finalTitle;
    let titleAi = false;
    let descAi = false;
    const edits: FieldEdit[] = p.edits.map((e) => {
      if ((e.field === "title" || e.field === "description") && res[e.field]) {
        if (e.field === "title") { title = res.title!; titleAi = true; } else descAi = true;
        return { ...e, after: res[e.field]!, source: providerId };
      }
      return e;
    });
    // social preview tags mirror whatever title/description ended up winning
    const desc = edits.find((e) => e.field === "description")?.after;
    const synced = edits.map((e) =>
      e.field === "og:title" && titleAi && title ? { ...e, after: title, source: providerId }
      : e.field === "og:description" && descAi && desc ? { ...e, after: desc, source: providerId }
      : e
    );
    return { ...p, edits: synced, finalTitle: title };
  });
}

/** Which fields of a proposal are worth sending to a model. */
export function copyRequests(proposals: PageProposal[], siteName: string | null): CopyRequest[] {
  return proposals
    .map((p) => ({
      path: p.path,
      siteName,
      context: p.context,
      wants: p.edits.filter((e) => e.field === "title" || e.field === "description").map((e) => e.field as "title" | "description"),
    }))
    .filter((r) => r.wants.length > 0);
}
