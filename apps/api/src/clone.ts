import { pg } from "./db";
import { fetchReferringHosts } from "./connectors/backlinks";
import type { CloneReport, CloneAction, CloneGaps } from "../../../shared/types";

/**
 * Clone engine — reverse-engineers a competitor's public strategy.
 *
 * Uses only public, free data: the target's own sitemap and pages, plus
 * whatever the site's backlink table already holds. It does not touch
 * logged-in or ToS-restricted sources, and every number it reports is an
 * estimate, flagged as such in the output.
 */

const MAX_PAGES = 25;
const FETCH_TIMEOUT_MS = 10000;
const STOPWORDS = new Set([
  "the","and","for","with","that","this","from","your","you","are","our","how",
  "what","why","best","top","guide","a","an","of","to","in","on","is","it","be",
  "or","as","at","by","we","us","can","will","not","all","more","new","do",
]);

/** Navigation and chrome that appears on every page of any site. */
const BOILERPLATE = new Set([
  "blog","posts","post","home","page","pages","news","article","articles",
  "archive","read","menu","search","login","signup","contact","about",
  "privacy","terms","cookie","cookies","subscribe","newsletter","rss","share",
  "comments","tags","categories","skip","content","navigation","footer",
]);

type PageFacts = {
  url: string;
  title: string;
  headings: string[];
  wordCount: number;
  schemaTypes: string[];
  internalLinks: string[];
};

/* ---------- Crawling ---------- */

async function fetchText(url: string): Promise<string | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { "User-Agent": "seo-aeo-geo-dashboard/0.1 (+public-data-only)" },
      redirect: "follow",
    });
    if (!res.ok) return null;
    return await res.text();
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** Reads sitemap.xml, following one level of sitemap index nesting. */
async function discoverUrls(domain: string): Promise<string[]> {
  const roots = [`https://${domain}/sitemap.xml`, `https://${domain}/sitemap_index.xml`];
  const found: string[] = [];

  for (const root of roots) {
    const xml = await fetchText(root);
    if (!xml) continue;

    const locs = [...xml.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/gi)].map((m) => m[1]);
    const nested = locs.filter((u) => /\.xml(\.gz)?$/i.test(u)).slice(0, 3);
    const pages = locs.filter((u) => !/\.xml(\.gz)?$/i.test(u));
    found.push(...pages);

    for (const child of nested) {
      const childXml = await fetchText(child);
      if (!childXml) continue;
      found.push(
        ...[...childXml.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/gi)]
          .map((m) => m[1])
          .filter((u) => !/\.xml(\.gz)?$/i.test(u))
      );
    }
    if (found.length) break;
  }

  // No sitemap is common; fall back to the homepage so the report is still useful.
  if (!found.length) found.push(`https://${domain}/`);
  return [...new Set(found)].slice(0, MAX_PAGES);
}

function stripTags(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&[a-z]+;/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Extracts the structural facts a strategy diff needs from one page. */
export function extractFacts(url: string, html: string): PageFacts {
  const title = (/<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1] ?? "").trim();

  const headings = [...html.matchAll(/<h([1-3])[^>]*>([\s\S]*?)<\/h\1>/gi)]
    .map((m) => stripTags(m[2]))
    .filter(Boolean)
    .slice(0, 40);

  const schemaTypes = new Set<string>();
  for (const m of html.matchAll(
    /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi
  )) {
    try {
      const walk = (node: any) => {
        if (!node) return;
        if (Array.isArray(node)) return node.forEach(walk);
        if (typeof node === "object") {
          const t = node["@type"];
          if (typeof t === "string") schemaTypes.add(t);
          else if (Array.isArray(t)) t.forEach((x) => typeof x === "string" && schemaTypes.add(x));
          Object.values(node).forEach(walk);
        }
      };
      walk(JSON.parse(m[1]));
    } catch {
      // Malformed JSON-LD is common in the wild; skip it.
    }
  }
  // Microdata is still widely used alongside JSON-LD.
  for (const m of html.matchAll(/itemtype=["']https?:\/\/schema\.org\/([A-Za-z]+)["']/gi)) {
    schemaTypes.add(m[1]);
  }

  let host = "";
  try {
    host = new URL(url).hostname;
  } catch {
    /* url came from a sitemap; ignore */
  }
  const internalLinks = [...html.matchAll(/<a[^>]+href=["']([^"'#]+)["']/gi)]
    .map((m) => m[1])
    .filter((h) => h.startsWith("/") || (host && h.includes(host)))
    .slice(0, 100);

  return {
    url,
    title,
    headings,
    wordCount: stripTags(html).split(/\s+/).filter(Boolean).length,
    schemaTypes: [...schemaTypes],
    internalLinks,
  };
}

/* ---------- Topic surface ---------- */

/**
 * Brand tokens for a domain, so a competitor's own name is not reported as a
 * content "topic". Covers subdomains ("blog.rust-lang.org" -> rust, lang) and
 * multi-part public suffixes ("example.co.uk" -> example).
 */
function brandTokens(domain: string): Set<string> {
  const labels = domain.toLowerCase().split(".");
  labels.pop(); // TLD
  // Second-level public suffixes that are not the brand.
  if (labels.length > 1 && ["co", "com", "org", "net", "gov", "ac", "edu"].includes(labels[labels.length - 1])) {
    labels.pop();
  }
  const tokens = new Set<string>();
  for (const label of labels) {
    for (const token of label.split(/[-_]/)) {
      // "blog"/"www" are chrome, not brand; BOILERPLATE already covers them.
      if (token.length > 2 && !BOILERPLATE.has(token) && token !== "www") tokens.add(token);
    }
  }
  return tokens;
}

/**
 * Ranks the recurring themes across a set of headings and titles.
 *
 * Bigrams are weighted above single words because they read as real topics
 * ("crm pricing") rather than noise ("crm"). Brand tokens, boilerplate and
 * degenerate repeats ("rust rust") are dropped so the gap list is actionable.
 */
export function extractTopics(facts: PageFacts[], limit = 25, excludeDomain?: string): string[] {
  const counts = new Map<string, number>();
  const brand = excludeDomain ? brandTokens(excludeDomain) : new Set<string>();

  const isNoise = (term: string) =>
    term.split(" ").every((w) => brand.has(w) || STOPWORDS.has(w) || BOILERPLATE.has(w));

  for (const page of facts) {
    for (const text of [page.title, ...page.headings]) {
      const words = (text.toLowerCase().match(/[a-z][a-z0-9'-]+/g) ?? []).filter(
        (w) => w.length > 2 && !STOPWORDS.has(w)
      );
      for (let i = 0; i < words.length; i++) {
        if (!brand.has(words[i]) && !BOILERPLATE.has(words[i])) {
          counts.set(words[i], (counts.get(words[i]) ?? 0) + 1);
        }
        // "rust rust" is a heading-concatenation artefact, not a topic.
        if (i + 1 < words.length && words[i] !== words[i + 1]) {
          const bigram = `${words[i]} ${words[i + 1]}`;
          if (!isNoise(bigram)) counts.set(bigram, (counts.get(bigram) ?? 0) + 3);
        }
      }
    }
  }

  return [...counts.entries()]
    .filter(([term, n]) => n > 1 && !isNoise(term))
    // A bigram that only ever appears inside a longer phrase adds no signal
    // beyond it; rank by weight, then prefer the more specific term.
    .sort((a, b) => b[1] - a[1] || b[0].length - a[0].length)
    .slice(0, limit)
    .map(([term]) => term);
}

/* ---------- Report ---------- */

export async function runClone(opts: {
  targetDomain: string;
  siteId: number;
}): Promise<CloneReport> {
  const target = opts.targetDomain
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/\/.*$/, "");
  if (!target || !target.includes(".")) throw new Error("targetDomain must be a domain like competitor.com");

  const site = await pg.query("SELECT domain FROM sites WHERE id = $1", [opts.siteId]);
  if (!site.rows.length) throw new Error(`site ${opts.siteId} not found`);
  const ownDomain: string = site.rows[0].domain;

  /* 1. Crawl the target. */
  const urls = await discoverUrls(target);
  const facts: PageFacts[] = [];
  for (const url of urls) {
    const html = await fetchText(url);
    if (html) facts.push(extractFacts(url, html));
  }
  if (!facts.length) {
    throw new Error(`could not fetch any public pages from ${target}`);
  }

  /* 2. Crawl our own site for the same surface, so the diff is like-for-like. */
  const ownUrls = await discoverUrls(ownDomain);
  const ownFacts: PageFacts[] = [];
  for (const url of ownUrls.slice(0, 15)) {
    const html = await fetchText(url);
    if (html) ownFacts.push(extractFacts(url, html));
  }

  /* 3. Gap analysis. */
  const targetTopics = extractTopics(facts, 25, target);
  const ownTopics = new Set(extractTopics(ownFacts, 60, ownDomain));
  const targetSchema = new Set(facts.flatMap((f) => f.schemaTypes));
  const ownSchema = new Set(ownFacts.flatMap((f) => f.schemaTypes));

  const ownBacklinks = await pg.query(
    "SELECT DISTINCT source FROM backlinks WHERE site_id = $1 AND lost = FALSE",
    [opts.siteId]
  );
  const ownLinkHosts = new Set(
    ownBacklinks.rows.map((r) => {
      try {
        return new URL(r.source.startsWith("http") ? r.source : `https://${r.source}`).hostname.replace(/^www\./, "");
      } catch {
        return r.source;
      }
    })
  );

  // Prompts where the target is named in an LLM answer but we are not.
  const uncited = await pg.query(
    `SELECT DISTINCT prompt FROM geo_prompts
     WHERE site_id = $1 AND cited = FALSE
     ORDER BY prompt LIMIT 20`,
    [opts.siteId]
  );

  // Referring hosts the target has and we do not — free Common Crawl data, so
  // an outage here must not sink the rest of the report.
  const targetLinkHosts = await fetchReferringHosts(target).catch(() => [] as string[]);

  const gaps: CloneGaps = {
    topics: targetTopics.filter((t) => !ownTopics.has(t)).slice(0, 15),
    schema: [...targetSchema].filter((s) => !ownSchema.has(s)),
    backlinks: targetLinkHosts.filter((h) => !ownLinkHosts.has(h)).slice(0, 20),
    llmPrompts: uncited.rows.map((r) => r.prompt),
  };

  /* 4. Actions, highest-leverage first. */
  const actions: CloneAction[] = [];

  gaps.topics.slice(0, 5).forEach((topic, i) =>
    actions.push({
      type: "content",
      title: `Cover "${topic}"`,
      priority: 1 + Math.floor(i / 2),
      rationale: `${target} ranks content around "${topic}"; ${ownDomain} has no page targeting it (estimated from ${facts.length} crawled pages).`,
    })
  );

  gaps.schema.slice(0, 5).forEach((type) =>
    actions.push({
      type: "schema",
      title: `Add ${type} structured data`,
      priority: type === "FAQPage" || type === "HowTo" ? 1 : 2,
      rationale: `${target} marks up ${type}, which feeds answer engines and rich results. ${ownDomain} does not.`,
    })
  );

  gaps.backlinks.slice(0, 5).forEach((host) =>
    actions.push({
      type: "outreach",
      title: `Earn a link from ${host}`,
      priority: 2,
      rationale: `${host} links to ${target} but not to ${ownDomain} (estimated from public crawl data).`,
    })
  );

  gaps.llmPrompts.slice(0, 5).forEach((prompt) =>
    actions.push({
      type: "geo",
      title: `Win citation for "${prompt}"`,
      priority: 1,
      rationale: `LLMs answer this prompt without citing ${ownDomain}. Publish a directly quotable answer with clear attribution.`,
    })
  );

  const report: CloneReport = {
    targetDomain: target,
    siteId: opts.siteId,
    pagesAnalyzed: facts.length,
    estimated: true,
    yourGaps: gaps,
    recommendedActions: actions.sort((a, b) => a.priority - b.priority),
  };

  await pg.query(
    "INSERT INTO clone_reports (site_id, target_domain, report) VALUES ($1, $2, $3)",
    [opts.siteId, target, JSON.stringify(report)]
  );

  return report;
}
