import { pg } from "./db";
import type { Debrief, DebriefPrompt, DebriefScope } from "../../../shared/types";

/**
 * Debrief generator.
 *
 * Turns the site's stored findings into self-contained, prompt-engineering
 * grade prompts the user can hand to an agency or paste into ChatGPT/Claude.
 *
 * Every generated prompt carries: role, task, the site's real data, explicit
 * constraints, an output format, and measurable success criteria — so the
 * recipient needs no further context and the output can be graded.
 */

const SCOPES: DebriefScope[] = ["full", "content", "aeo", "geo", "regional"];

type SiteFindings = {
  domain: string;
  keywords: { keyword: string; position: number | null; clicks: number; impressions: number }[];
  weakKeywords: { keyword: string; position: number | null; impressions: number }[];
  uncitedPrompts: { prompt: string; model: string; excerpt: string | null }[];
  citedPrompts: { prompt: string; model: string }[];
  visibility: number;
  topCountries: { country: string; value: number }[];
  latestClone: any | null;
};

async function gather(siteId: number, country?: string): Promise<SiteFindings> {
  const site = await pg.query("SELECT domain FROM sites WHERE id = $1", [siteId]);
  if (!site.rows.length) throw new Error(`site ${siteId} not found`);

  const keywords = await pg.query(
    `SELECT keyword, position, clicks, impressions FROM keywords
     WHERE site_id = $1 ORDER BY impressions DESC NULLS LAST LIMIT 40`,
    [siteId]
  );

  // High impressions but a poor position is the clearest content opportunity.
  const weak = await pg.query(
    `SELECT keyword, position, impressions FROM keywords
     WHERE site_id = $1 AND (position IS NULL OR position > 10)
     ORDER BY impressions DESC NULLS LAST LIMIT 20`,
    [siteId]
  );

  const uncited = await pg.query(
    `SELECT prompt, model, excerpt FROM geo_prompts
     WHERE site_id = $1 AND cited = FALSE ORDER BY updated_at DESC LIMIT 20`,
    [siteId]
  );
  const cited = await pg.query(
    `SELECT prompt, model FROM geo_prompts
     WHERE site_id = $1 AND cited = TRUE ORDER BY updated_at DESC LIMIT 20`,
    [siteId]
  );

  const total = await pg.query(
    `SELECT COUNT(*)::int AS n, COUNT(*) FILTER (WHERE cited)::int AS c
     FROM geo_prompts WHERE site_id = $1`,
    [siteId]
  );
  const { n, c } = total.rows[0] ?? { n: 0, c: 0 };

  const regional = await pg.query(
    `SELECT country, value FROM regional_metrics
     WHERE site_id = $1 AND metric = 'clicks' ${country ? "AND country = $2" : ""}
     ORDER BY value DESC NULLS LAST LIMIT 10`,
    country ? [siteId, country.toUpperCase()] : [siteId]
  );

  const clone = await pg.query(
    "SELECT report FROM clone_reports WHERE site_id = $1 ORDER BY created_at DESC LIMIT 1",
    [siteId]
  );

  return {
    domain: site.rows[0].domain,
    keywords: keywords.rows,
    weakKeywords: weak.rows,
    uncitedPrompts: uncited.rows,
    citedPrompts: cited.rows,
    visibility: n ? Math.round((c / n) * 100) : 0,
    topCountries: regional.rows,
    latestClone: clone.rows[0]?.report ?? null,
  };
}

/** Renders a list for embedding in a prompt, with a placeholder when empty. */
function list(items: string[], empty = "(no data yet — run the relevant sync first)"): string {
  return items.length ? items.map((i) => `- ${i}`).join("\n") : empty;
}

/* ---------- Prompt builders ---------- */

function contentPrompts(f: SiteFindings, audience: string, tone: string): DebriefPrompt[] {
  const weak = f.weakKeywords.map(
    (k) => `"${k.keyword}" — position ${k.position ?? "unranked"}, ${k.impressions} impressions`
  );
  const topics = f.latestClone?.yourGaps?.topics ?? [];

  return [
    {
      id: "content-1",
      category: "content",
      title: "Write pillar pages for high-impression, low-rank keywords",
      prompt: `You are a senior SEO content strategist.

TASK
Produce a pillar-page content plan for ${f.domain}, targeting ${audience}.

DATA — keywords where we already earn impressions but rank poorly:
${list(weak)}

CONSTRAINTS
- One pillar page per theme; group the keywords above into no more than 5 themes.
- Each pillar must target a primary keyword plus 3-6 supporting long-tail terms from the list.
- Write in a ${tone} tone. Do not invent statistics or cite sources you cannot verify.
- Every page must answer its primary question in the first 120 words, so answer engines can quote it.

OUTPUT FORMAT
A markdown table: | Theme | Primary keyword | Supporting keywords | Working title | Target word count | Internal links to build |
Then, beneath the table, an H2/H3 outline for the single highest-priority page.

SUCCESS CRITERIA
- Every keyword above appears in exactly one theme.
- Each working title is under 60 characters.
- The outline contains at least 3 question-form H2s suitable for FAQ schema.`,
      inputs: { weakKeywords: f.weakKeywords, audience },
    },
    {
      id: "content-2",
      category: "content",
      title: "Close competitor topic gaps",
      prompt: `You are a content gap analyst.

TASK
${f.domain} competes with ${f.latestClone?.targetDomain ?? "(run a clone report to populate this)"}. Turn the topic gaps below into a prioritised editorial backlog.

DATA — topics the competitor covers and ${f.domain} does not:
${list(topics)}

CONSTRAINTS
- Rank by commercial intent first, effort second. Label all competitor figures as estimated.
- Reject any topic that does not plausibly fit ${f.domain}'s audience (${audience}); say why you rejected it.

OUTPUT FORMAT
| Priority | Topic | Search intent | Page type | Effort (S/M/L) | Why it matters |
Then a short "Rejected topics" list with one-line reasons.

SUCCESS CRITERIA
- Every input topic appears either in the table or in the rejected list.
- Priorities are 1-3 with no more than 5 items at priority 1.`,
      inputs: { topics, competitor: f.latestClone?.targetDomain ?? null },
    },
  ];
}

function aeoPrompts(f: SiteFindings): DebriefPrompt[] {
  const questionHeadings = f.keywords
    .filter((k) => /^(what|why|how|when|where|who|is|can|does|should)\b/i.test(k.keyword))
    .map((k) => k.keyword);
  const schemaGaps = f.latestClone?.yourGaps?.schema ?? [];

  return [
    {
      id: "aeo-1",
      category: "aeo",
      title: "Generate FAQPage schema for question keywords",
      prompt: `You are a technical SEO engineer specialising in structured data.

TASK
Produce valid FAQPage JSON-LD for ${f.domain} covering the questions below.

DATA — question-form queries ${f.domain} already receives impressions for:
${list(questionHeadings)}

CONSTRAINTS
- Output schema.org FAQPage JSON-LD, one block per page grouping related questions.
- Each answer must be 40-60 words, self-contained, and quotable without surrounding context.
- Answers must contain no marketing claims that cannot be substantiated on the page itself.
- Do not mark up a question whose answer is not actually present in the page copy.

OUTPUT FORMAT
For each block: the target URL, then a fenced \`\`\`json code block with the JSON-LD.

SUCCESS CRITERIA
- Every JSON block validates against schema.org FAQPage.
- No answer exceeds 60 words.
- Questions are phrased exactly as users search them.`,
      inputs: { questions: questionHeadings },
    },
    {
      id: "aeo-2",
      category: "aeo",
      title: "Add missing structured data types",
      prompt: `You are a structured data auditor.

TASK
Specify how ${f.domain} should implement the schema types it is currently missing.

DATA — types competitors use that ${f.domain} does not:
${list(schemaGaps)}

CONSTRAINTS
- Only recommend a type where the page genuinely contains the underlying content.
- Flag any type that risks a manual action if misapplied.

OUTPUT FORMAT
| Schema type | Which pages | Required properties | Implementation note | Risk |

SUCCESS CRITERIA
- Every required property listed is genuinely required by schema.org.
- At least one concrete example block is provided for the highest-value type.`,
      inputs: { schemaGaps },
    },
  ];
}

function geoPrompts(f: SiteFindings): DebriefPrompt[] {
  const misses = f.uncitedPrompts.map(
    (p) => `"${p.prompt}" (${p.model}) — model answered: ${(p.excerpt ?? "").slice(0, 160)}`
  );
  const wins = f.citedPrompts.map((p) => `"${p.prompt}" (${p.model})`);

  return [
    {
      id: "geo-1",
      category: "geo",
      title: "Improve LLM citation rate",
      prompt: `You are a generative engine optimisation (GEO) specialist.

TASK
${f.domain} is cited in ${f.visibility}% of tracked LLM answers. Diagnose the misses below and propose content changes that would earn a citation.

DATA — prompts where ${f.domain} was NOT cited, with what the model said instead:
${list(misses)}

DATA — prompts where ${f.domain} WAS cited (use these as the pattern to replicate):
${list(wins, "(none yet)")}

CONSTRAINTS
- For each miss, name the specific entity the model cited instead and what that source provides that we do not.
- Recommendations must be content or structure changes, never attempts to manipulate the model.
- Prefer changes that make our claim uniquely verifiable: original data, named authorship, explicit dates.

OUTPUT FORMAT
| Prompt | Who gets cited instead | Why they win | Our fix | Effort |
Then: "Top 3 changes this quarter" with one paragraph each.

SUCCESS CRITERIA
- Every uncited prompt appears in the table.
- Each fix names a specific URL to create or edit.
- No recommendation relies on unverifiable claims.`,
      inputs: { visibility: f.visibility, uncited: f.uncitedPrompts, cited: f.citedPrompts },
    },
  ];
}

function regionalPrompts(f: SiteFindings, country: string | undefined, audience: string): DebriefPrompt[] {
  const target = country?.toUpperCase() ?? f.topCountries[0]?.country ?? "(no regional data yet)";
  const pages = f.keywords.slice(0, 15).map((k) => `"${k.keyword}" — ${k.clicks} clicks, position ${k.position ?? "n/a"}`);

  return [
    {
      id: "regional-1",
      category: "regional",
      title: `Localize top pages for ${target}`,
      prompt: `You are an international SEO consultant.

TASK
Adapt ${f.domain}'s top-performing content for the ${target} market, targeting ${audience}.

DATA — current top queries and performance:
${list(pages)}

DATA — traffic by country:
${list(f.topCountries.map((c) => `${c.country}: ${Math.round(c.value)} clicks`))}

CONSTRAINTS
- Preserve the original keyword intent; translate meaning, not words.
- Specify hreflang pairs for every localized URL, including x-default.
- Adjust schema for the local locale (currency, language, region-specific types).
- Flag any query whose intent does not transfer to ${target}, and say why.

OUTPUT FORMAT
| Source URL | Localized URL | Local primary keyword | hreflang entries | Schema changes | Notes |
Then a short "Do not localize" list with reasons.

SUCCESS CRITERIA
- Every hreflang set is reciprocal and includes x-default.
- Local keywords are real search terms in the target language, not literal translations.`,
      inputs: { country: target, topCountries: f.topCountries },
    },
  ];
}

/* ---------- Entry point ---------- */

export async function generateDebrief(opts: {
  siteId: number;
  scope?: DebriefScope;
  targetAudience?: string;
  tone?: string;
  country?: string;
}): Promise<Debrief> {
  const scope: DebriefScope = opts.scope ?? "full";
  if (!SCOPES.includes(scope)) {
    throw new Error(`scope must be one of ${SCOPES.join(", ")}`);
  }

  const f = await gather(opts.siteId, opts.country);
  const audience = opts.targetAudience?.trim() || "the site's existing audience";
  const tone = opts.tone?.trim() || "clear, factual";

  const prompts: DebriefPrompt[] = [];
  if (scope === "full" || scope === "content") prompts.push(...contentPrompts(f, audience, tone));
  if (scope === "full" || scope === "aeo") prompts.push(...aeoPrompts(f));
  if (scope === "full" || scope === "geo") prompts.push(...geoPrompts(f));
  if (scope === "full" || scope === "regional") prompts.push(...regionalPrompts(f, opts.country, audience));

  const summary =
    `${f.domain}: ${f.keywords.length} keywords tracked, ` +
    `${f.weakKeywords.length} with rank-improvement headroom, ` +
    `${f.visibility}% LLM citation rate across ${f.uncitedPrompts.length + f.citedPrompts.length} tracked prompts, ` +
    `${f.topCountries.length} countries with regional data` +
    (f.latestClone ? `, clone report against ${f.latestClone.targetDomain}` : ", no clone report yet") +
    `. Generated ${prompts.length} prompts for scope "${scope}".`;

  return { summary, scope, prompts };
}

/** Renders a debrief as the markdown file the CLI writes with --out. */
export function debriefToMarkdown(d: Debrief, domain?: string): string {
  const header = `# SEO / AEO / GEO Debrief${domain ? ` — ${domain}` : ""}\n\n` +
    `**Scope:** ${d.scope}  \n**Generated:** ${new Date().toISOString()}\n\n` +
    `${d.summary}\n\n---\n`;

  const body = d.prompts
    .map(
      (p) =>
        `\n## ${p.title}\n\n_Category: ${p.category} · id: ${p.id}_\n\n` +
        "```text\n" + p.prompt + "\n```\n"
    )
    .join("\n");

  return header + body;
}
