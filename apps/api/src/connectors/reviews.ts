import { envKey } from "../env";
import { pg, publishUpdate } from "../db";
import { blendedSentiment } from "./sentiment";
import type { ConnectorStatus, CitationKind } from "../../../../shared/types";

/**
 * Reviews and citations.
 *
 * Reviews come from key-gated platform APIs; a platform without a key is
 * reported as disabled rather than guessed at. Citations are discovered from
 * the backlinks already stored for the site and scored by source authority,
 * which needs no additional key.
 */

/* ---------- Reviews ---------- */

export type ReviewRow = {
  source: string;
  author?: string | null;
  rating?: number | null;
  body?: string | null;
  postedAt?: string | null;
  url?: string | null;
};

type ReviewAdapter = {
  name: string;
  envVar: string;
  fetch: (domain: string, key: string) => Promise<ReviewRow[]>;
};

const REVIEW_ADAPTERS: ReviewAdapter[] = [
  {
    name: "trustpilot",
    envVar: "TRUSTPILOT_API_KEY",
    async fetch(domain, key) {
      const res = await fetch(
        `https://api.trustpilot.com/v1/business-units/find?name=${encodeURIComponent(domain)}`,
        { headers: { apikey: key } }
      );
      if (!res.ok) throw new Error(`trustpilot lookup: ${res.status}`);
      const unit = (await res.json()) as any;
      const id = unit?.id ?? unit?.businessUnits?.[0]?.id;
      if (!id) return [];

      const rev = await fetch(
        `https://api.trustpilot.com/v1/business-units/${id}/reviews?perPage=100`,
        { headers: { apikey: key } }
      );
      if (!rev.ok) throw new Error(`trustpilot reviews: ${rev.status}`);
      return ((await rev.json() as any).reviews ?? []).map((r: any) => ({
        source: "trustpilot",
        author: r.consumer?.displayName ?? null,
        rating: r.stars ?? null,
        body: r.text ?? null,
        postedAt: r.createdAt ?? null,
        url: r.links?.find((l: any) => l.rel === "self")?.href ?? null,
      }));
    },
  },
  {
    name: "g2",
    envVar: "G2_API_KEY",
    async fetch(domain, key) {
      const res = await fetch(
        `https://data.g2.com/api/v1/survey-responses?filter[product_name]=${encodeURIComponent(domain)}&page[size]=100`,
        { headers: { Authorization: `Token token=${key}`, "Content-Type": "application/vnd.api+json" } }
      );
      if (!res.ok) throw new Error(`g2: ${res.status}`);
      return ((await res.json() as any).data ?? []).map((d: any) => ({
        source: "g2",
        author: d.attributes?.user_name ?? null,
        rating: d.attributes?.star_rating ?? null,
        body: d.attributes?.comment_answers?.love?.value ?? d.attributes?.title ?? null,
        postedAt: d.attributes?.submitted_at ?? null,
        url: d.attributes?.url ?? null,
      }));
    },
  },
  {
    name: "google_business",
    envVar: "GOOGLE_BUSINESS_API_KEY",
    async fetch(domain, key) {
      // Resolve the place from the domain, then read its reviews.
      const find = await fetch(
        `https://places.googleapis.com/v1/places:searchText`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Goog-Api-Key": key,
            "X-Goog-FieldMask": "places.id,places.displayName",
          },
          body: JSON.stringify({ textQuery: domain }),
        }
      );
      if (!find.ok) throw new Error(`google places search: ${find.status}`);
      const placeId = (await find.json() as any).places?.[0]?.id;
      if (!placeId) return [];

      const det = await fetch(`https://places.googleapis.com/v1/places/${placeId}`, {
        headers: { "X-Goog-Api-Key": key, "X-Goog-FieldMask": "reviews" },
      });
      if (!det.ok) throw new Error(`google places details: ${det.status}`);
      return ((await det.json() as any).reviews ?? []).map((r: any) => ({
        source: "google_business",
        author: r.authorAttribution?.displayName ?? null,
        rating: r.rating ?? null,
        body: r.originalText?.text ?? r.text?.text ?? null,
        postedAt: r.publishTime ?? null,
        url: r.googleMapsUri ?? null,
      }));
    },
  },
];

export function reviewStatus(): ConnectorStatus[] {
  return REVIEW_ADAPTERS.map((a) => ({
    name: a.name,
    enabled: envKey(a.envVar) !== undefined,
    reason: envKey(a.envVar) ? undefined : `${a.envVar} not set`,
  }));
}

/**
 * Pulls reviews from every platform whose key is configured, scores sentiment,
 * and stores them. Returns per-source counts; a platform that errors is
 * reported without failing the others.
 */
export async function syncReviews(
  siteId: number
): Promise<{ total: number; bySource: Record<string, number>; errors: string[] }> {
  const site = await pg.query("SELECT domain FROM sites WHERE id = $1", [siteId]);
  if (!site.rows.length) throw new Error(`site ${siteId} not found`);
  const domain: string = site.rows[0].domain;

  const enabled = REVIEW_ADAPTERS.filter((a) => envKey(a.envVar));
  if (!enabled.length) {
    throw new Error(
      `no review platforms enabled — set one of ${REVIEW_ADAPTERS.map((a) => a.envVar).join(", ")} in .env`
    );
  }

  const bySource: Record<string, number> = {};
  const errors: string[] = [];
  let total = 0;

  for (const adapter of enabled) {
    try {
      const rows = await adapter.fetch(domain, envKey(adapter.envVar)!);
      for (const r of rows) {
        await pg.query(
          `INSERT INTO reviews (site_id, source, author, rating, body, sentiment, posted_at, url)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
          [
            siteId,
            r.source,
            r.author ?? null,
            r.rating ?? null,
            r.body ?? null,
            blendedSentiment(r.rating, r.body),
            r.postedAt ?? null,
            r.url ?? null,
          ]
        );
      }
      bySource[adapter.name] = rows.length;
      total += rows.length;
    } catch (e: any) {
      errors.push(`${adapter.name}: ${e.message}`);
    }
  }

  await publishUpdate({ kind: "reviews", siteId, payload: { total } });
  return { total, bySource, errors };
}

/* ---------- Citations ---------- */

/** Classifies a source URL and scores how much authority a citation carries. */
export function classifyCitation(url: string): { kind: CitationKind; authority: number } {
  let host = "";
  try {
    host = new URL(url.startsWith("http") ? url : `https://${url}`).hostname.toLowerCase();
  } catch {
    return { kind: "other", authority: 10 };
  }

  if (/\.gov(\.[a-z]{2})?$/.test(host) || host.endsWith(".mil")) return { kind: "gov", authority: 95 };
  if (/\.edu(\.[a-z]{2})?$/.test(host) || host.endsWith(".ac.uk")) return { kind: "edu", authority: 90 };
  if (/(nature|sciencedirect|springer|wiley|pubmed|ncbi|arxiv|jstor|doi)\./.test(host)) {
    return { kind: "journal", authority: 88 };
  }
  if (/(crunchbase|g2|capterra|yelp|bbb|trustpilot|clutch|producthunt)\./.test(host)) {
    return { kind: "directory", authority: 60 };
  }
  if (/(twitter|x\.com|linkedin|facebook|reddit|youtube|instagram|mastodon)\./.test(host)) {
    return { kind: "social", authority: 35 };
  }
  if (host.endsWith(".org")) return { kind: "directory", authority: 55 };
  return { kind: "other", authority: 25 };
}

/**
 * Derives authority-scored citations from the site's stored backlinks. Free —
 * it reuses data the backlink sync already pulled, so it needs no extra key.
 */
export async function syncCitations(siteId: number): Promise<{ rows: number }> {
  const { rows } = await pg.query(
    "SELECT DISTINCT source FROM backlinks WHERE site_id = $1 AND lost = FALSE",
    [siteId]
  );

  let written = 0;
  for (const row of rows) {
    const { kind, authority } = classifyCitation(row.source);
    // Social chatter is not a credible citation; keep the list meaningful.
    if (kind === "other" || kind === "social") continue;

    const host = (() => {
      try {
        return new URL(row.source.startsWith("http") ? row.source : `https://${row.source}`).hostname;
      } catch {
        return row.source;
      }
    })();

    await pg.query(
      `INSERT INTO citations (site_id, source, url, authority, kind, verified)
       VALUES ($1, $2, $3, $4, $5, TRUE)
       ON CONFLICT (site_id, url)
       DO UPDATE SET authority = EXCLUDED.authority, kind = EXCLUDED.kind`,
      [siteId, host, row.source, authority, kind]
    );
    written++;
  }

  await publishUpdate({ kind: "citations", siteId, payload: { rows: written } });
  return { rows: written };
}
