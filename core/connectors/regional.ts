import type { Ctx } from "../ports.ts";
import { now } from "../ports.ts";
import type { RegionalMetricName } from "../types";

/**
 * Regional metrics feeding the world map.
 *
 * Derived from data already stored rather than a paid geo API: clicks,
 * impressions and rank come from the GSC country dimension on `keywords`, and
 * llm_citations from `geo_prompts`. No extra key required.
 */

export async function syncRegional(ctx: Ctx, siteId: number): Promise<{ rows: number; countries: number }> {
  const site = await ctx.db.first<{ id: number }>("SELECT id FROM sites WHERE id = ?", [siteId]);
  if (!site) throw new Error(`site ${siteId} not found`);

  // CAST rather than Postgres' ::float, so the statement runs on D1 too.
  const agg = await ctx.db.all<{ country: string; clicks: number; impressions: number; rank: number }>(
    `SELECT country,
            CAST(SUM(clicks) AS REAL)      AS clicks,
            CAST(SUM(impressions) AS REAL) AS impressions,
            CAST(AVG(position) AS REAL)    AS rank
     FROM keywords
     WHERE site_id = ? AND country IS NOT NULL AND country <> ''
     GROUP BY country`,
    [siteId]
  );

  const timestamp = now();
  let written = 0;

  const upsert = async (country: string, metric: string, value: number) => {
    await ctx.db.run(
      `INSERT INTO regional_metrics (site_id, country, region, metric, value, captured_at)
       VALUES (?, ?, NULL, ?, ?, ?)
       ON CONFLICT (site_id, country, COALESCE(region, ''), metric)
       DO UPDATE SET value = excluded.value, captured_at = excluded.captured_at`,
      [siteId, country, metric, value, timestamp]
    );
    written++;
  };

  for (const row of agg) {
    const country = normalizeCountry(row.country);
    for (const [metric, value] of [
      ["clicks", row.clicks],
      ["impressions", row.impressions],
      ["rank", row.rank],
    ] as const) {
      if (value != null) await upsert(country, metric, value);
    }
  }

  // LLM citations are not country-dimensioned upstream, so they are attributed
  // to the site's strongest markets in proportion to impressions.
  const geo = await ctx.db.first<{ cited: number }>(
    "SELECT COUNT(*) AS cited FROM geo_prompts WHERE site_id = ? AND cited = 1",
    [siteId]
  );
  const cited = Number(geo?.cited ?? 0);

  if (cited > 0 && agg.length) {
    const totalImpressions = agg.reduce((sum, r) => sum + (r.impressions ?? 0), 0) || 1;
    for (const row of agg) {
      const share = (row.impressions ?? 0) / totalImpressions;
      await upsert(normalizeCountry(row.country), "llm_citations", Math.round(cited * share * 100) / 100);
    }
  }

  await ctx.bus.publish({ kind: "keywords", siteId, payload: { regional: written } });
  return { rows: written, countries: agg.length };
}

/**
 * GSC reports ISO-3166 alpha-3 ("deu"); the map layers expect alpha-2 ("DE").
 * Unrecognised codes pass through uppercased so no data is silently dropped.
 */
const ALPHA3_TO_ALPHA2: Record<string, string> = {
  usa: "US", gbr: "GB", deu: "DE", fra: "FR", esp: "ES", ita: "IT", nld: "NL",
  can: "CA", aus: "AU", nzl: "NZ", ind: "IN", jpn: "JP", chn: "CN", kor: "KR",
  bra: "BR", mex: "MX", arg: "AR", zaf: "ZA", swe: "SE", nor: "NO", dnk: "DK",
  fin: "FI", pol: "PL", irl: "IE", che: "CH", aut: "AT", bel: "BE", prt: "PT",
  sgp: "SG", are: "AE", isr: "IL", tur: "TR", rus: "RU", ukr: "UA", idn: "ID",
  phl: "PH", tha: "TH", vnm: "VN", mys: "MY", nga: "NG", ken: "KE", egy: "EG",
};

export function normalizeCountry(code: string): string {
  const c = code.trim().toLowerCase();
  if (c.length === 2) return c.toUpperCase();
  return ALPHA3_TO_ALPHA2[c] ?? c.toUpperCase();
}

/** Reads the stored rollup for the map and country table. */
export async function getRegional(ctx: Ctx, siteId: number, metric?: RegionalMetricName) {
  const rows = await ctx.db.all<{ country: string; region: string | null; metric: string; value: number }>(
    `SELECT country, region, metric, value, captured_at
     FROM regional_metrics
     WHERE site_id = ?${metric ? " AND metric = ?" : ""}
     ORDER BY value DESC`,
    metric ? [siteId, metric] : [siteId]
  );

  const byCountry: Record<string, Record<string, number | null>> = {};
  for (const r of rows) {
    byCountry[r.country] ??= {};
    byCountry[r.country][r.metric] = r.value;
  }
  return { countries: byCountry, rows };
}
