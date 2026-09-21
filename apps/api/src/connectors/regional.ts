import { pg, publishUpdate } from "../db";
import type { RegionalMetricName } from "../../../../shared/types";

/**
 * Regional metrics feeding the world map.
 *
 * Derived from data already in the database rather than a paid geo API:
 * clicks/impressions/rank come from the GSC country dimension stored on
 * `keywords`, and llm_citations from `geo_prompts`. No extra key required.
 */

/** Rolls the keywords table up by country into regional_metrics. */
export async function syncRegional(siteId: number): Promise<{ rows: number; countries: number }> {
  const site = await pg.query("SELECT id FROM sites WHERE id = $1", [siteId]);
  if (!site.rows.length) throw new Error(`site ${siteId} not found`);

  const { rows: agg } = await pg.query(
    `SELECT country,
            SUM(clicks)::float      AS clicks,
            SUM(impressions)::float AS impressions,
            AVG(position)::float    AS rank
     FROM keywords
     WHERE site_id = $1 AND country IS NOT NULL AND country <> ''
     GROUP BY country`,
    [siteId]
  );

  let written = 0;
  for (const row of agg) {
    const metrics: [RegionalMetricName, number | null][] = [
      ["clicks", row.clicks],
      ["impressions", row.impressions],
      ["rank", row.rank],
    ];
    for (const [metric, value] of metrics) {
      if (value == null) continue;
      await pg.query(
        `INSERT INTO regional_metrics (site_id, country, region, metric, value, captured_at)
         VALUES ($1, $2, NULL, $3, $4, NOW())
         ON CONFLICT (site_id, country, COALESCE(region, ''), metric)
         DO UPDATE SET value = EXCLUDED.value, captured_at = NOW()`,
        [siteId, normalizeCountry(row.country), metric, value]
      );
      written++;
    }
  }

  // LLM citations are not country-dimensioned upstream, so they are recorded
  // against the site's strongest markets proportionally to impressions.
  const { rows: geo } = await pg.query(
    "SELECT COUNT(*) FILTER (WHERE cited) AS cited FROM geo_prompts WHERE site_id = $1",
    [siteId]
  );
  const cited = Number(geo[0]?.cited ?? 0);
  if (cited > 0 && agg.length) {
    const totalImpressions = agg.reduce((s, r) => s + (r.impressions ?? 0), 0) || 1;
    for (const row of agg) {
      const share = (row.impressions ?? 0) / totalImpressions;
      await pg.query(
        `INSERT INTO regional_metrics (site_id, country, region, metric, value, captured_at)
         VALUES ($1, $2, NULL, 'llm_citations', $3, NOW())
         ON CONFLICT (site_id, country, COALESCE(region, ''), metric)
         DO UPDATE SET value = EXCLUDED.value, captured_at = NOW()`,
        [siteId, normalizeCountry(row.country), Math.round(cited * share * 100) / 100]
      );
      written++;
    }
  }

  await publishUpdate({ kind: "keywords", siteId, payload: { regional: written } });
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

/** Reads the stored regional rollup for the map and country table. */
export async function getRegional(siteId: number, metric?: RegionalMetricName) {
  const { rows } = await pg.query(
    `SELECT country, region, metric, value, captured_at
     FROM regional_metrics
     WHERE site_id = $1 ${metric ? "AND metric = $2" : ""}
     ORDER BY value DESC NULLS LAST`,
    metric ? [siteId, metric] : [siteId]
  );

  // Shape as one row per country so the choropleth can read it directly.
  const byCountry: Record<string, Record<string, number | null>> = {};
  for (const r of rows) {
    byCountry[r.country] ??= {};
    byCountry[r.country][r.metric] = r.value;
  }

  return { countries: byCountry, rows };
}
