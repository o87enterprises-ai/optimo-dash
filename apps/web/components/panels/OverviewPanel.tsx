"use client";

import Sparkline from "../Sparkline";
import { compact, percent, STATUS } from "../../lib/viz";

/**
 * Overview tiles.
 *
 * These are stat tiles, not charts: a single number is the clearest form for
 * "how many". A sparkline rides along only where a trend actually exists in
 * the data we hold.
 */

type Summary = {
  seo: { n: number; clicks: number; impressions: number; avg_position: number | null };
  geo: { n: number; cited: number; visibility: number };
  backlinks: { live: number; lost: number };
  reviews: { n: number; sentiment: number | null; rating: number | null };
  citations: { n: number; authority: number | null };
};

function Tile({
  title,
  value,
  meta,
  tone,
  spark,
}: {
  title: string;
  value: string | number;
  meta: string;
  tone?: string;
  spark?: { values: number[]; label: string };
}) {
  return (
    <div className="card">
      <h3>{title}</h3>
      <div className="value" style={tone ? { color: tone } : undefined}>
        {value}
      </div>
      <div className="tile-foot">
        <span className="meta">{meta}</span>
        {spark && <Sparkline values={spark.values} label={spark.label} />}
      </div>
    </div>
  );
}

export default function OverviewPanel({
  summary,
  keywords,
}: {
  summary: Summary;
  keywords: any[];
}) {
  // Rank distribution across the top keywords is the one real trend we can
  // draw without a history table; anything else would be invented.
  const rankTrend = keywords
    .filter((k) => k.position != null)
    .slice(0, 20)
    .map((k) => -Number(k.position));

  const sentiment = summary.reviews.sentiment;
  const sentimentTone =
    sentiment == null ? undefined : sentiment > 0.15 ? STATUS.good : sentiment < -0.15 ? STATUS.critical : undefined;

  return (
    <div className="grid">
      <Tile
        title="SEO · Keywords"
        value={compact(summary.seo.n)}
        meta={`${compact(summary.seo.clicks)} clicks · ${compact(summary.seo.impressions)} impressions`}
        spark={rankTrend.length > 1 ? { values: rankTrend, label: "Position across top keywords" } : undefined}
      />
      <Tile
        title="SEO · Average position"
        value={summary.seo.avg_position ? summary.seo.avg_position.toFixed(1) : "—"}
        meta="Lower is better"
      />
      <Tile
        title="GEO · LLM visibility"
        value={percent(summary.geo.visibility)}
        meta={`${summary.geo.cited} of ${summary.geo.n} tracked prompts cite you`}
      />
      <Tile
        title="Backlinks"
        value={compact(summary.backlinks.live)}
        meta={summary.backlinks.lost ? `${summary.backlinks.lost} lost` : "none lost"}
      />
      <Tile
        title="Citations"
        value={compact(summary.citations.n)}
        meta={summary.citations.authority ? `average authority ${Math.round(summary.citations.authority)}` : "Run a citation sync"}
      />
      <Tile
        title="Reviews"
        value={compact(summary.reviews.n)}
        meta={sentiment == null ? "No reviews yet" : `sentiment ${sentiment.toFixed(2)} · rating ${summary.reviews.rating?.toFixed(1) ?? "—"}`}
        tone={sentimentTone}
      />
    </div>
  );
}
