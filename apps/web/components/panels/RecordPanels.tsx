"use client";

import DataTable from "../DataTable";
import type { Column } from "../DataTable";
import { hostOf } from "../../lib/scene-data";
import { citedState, compact, linkState, position, shortDate, STATUS } from "../../lib/viz";

/**
 * The record tables beneath the scene: keywords, LLM prompts, backlinks,
 * reviews and citations.
 *
 * Each one doubles as the table view for the scene above it, which is what
 * lets the visualisation encode with colour at all.
 */

/** A status cell: mark, label and colour together — never colour alone. */
function StatusCell({ state }: { state: { color: string; mark: string; label: string } }) {
  return (
    <span style={{ color: state.color, whiteSpace: "nowrap" }}>
      <span aria-hidden="true">{state.mark} </span>
      {state.label}
    </span>
  );
}

export function KeywordsPanel({ rows, focus }: { rows: any[]; focus?: string }) {
  const columns: Column<any>[] = [
    { key: "keyword", label: "Keyword", value: (r) => r.keyword },
    { key: "position", label: "Position", value: (r) => r.position, numeric: true, descendingFirst: false, align: "right", render: (r) => position(r.position) },
    { key: "clicks", label: "Clicks", value: (r) => Number(r.clicks) || 0, numeric: true, align: "right", render: (r) => compact(r.clicks) },
    { key: "impressions", label: "Impressions", value: (r) => Number(r.impressions) || 0, numeric: true, align: "right", render: (r) => compact(r.impressions) },
    { key: "country", label: "Country", value: (r) => r.country ?? "—" },
    { key: "device", label: "Device", value: (r) => r.device ?? "—" },
  ];
  return (
    <DataTable
      rows={rows}
      columns={columns}
      initialSort="impressions"
      rowKey={(r, i) => `kw-${r.id ?? i}`}
      empty="No keywords yet. Run a Search Console sync, or add keys in Settings."
      highlight={(r) => Boolean(focus) && r.keyword === focus}
    />
  );
}

export function GeoPromptsPanel({ rows, focus }: { rows: any[]; focus?: string }) {
  const columns: Column<any>[] = [
    { key: "prompt", label: "Prompt", value: (r) => r.prompt },
    { key: "model", label: "Model", value: (r) => r.model },
    {
      key: "cited",
      label: "Cited",
      value: (r) => (r.cited ? 1 : 0),
      numeric: true,
      render: (r) => <StatusCell state={citedState(Boolean(r.cited))} />,
    },
    { key: "excerpt", label: "What the model said", value: (r) => r.excerpt ?? "" , render: (r) => <span className="excerpt">{r.excerpt || "—"}</span> },
    { key: "updated_at", label: "Checked", value: (r) => r.updated_at, align: "right", render: (r) => shortDate(r.updated_at) },
  ];
  return (
    <DataTable
      rows={rows}
      columns={columns}
      initialSort="updated_at"
      rowKey={(r, i) => `gp-${r.id ?? i}`}
      empty="No prompts tracked yet. Add an LLM key in Settings, then run a probe."
      highlight={(r) => Boolean(focus) && r.prompt === focus}
    />
  );
}

export function BacklinksPanel({ rows, focus }: { rows: any[]; focus?: string }) {
  const columns: Column<any>[] = [
    { key: "source", label: "Source", value: (r) => r.source, render: (r) => <a href={r.source} target="_blank" rel="noreferrer noopener">{hostOf(r.source)}</a> },
    { key: "anchor", label: "Anchor", value: (r) => r.anchor ?? "—" },
    { key: "da", label: "Domain authority", value: (r) => Number(r.domain_authority) || null, numeric: true, align: "right" },
    {
      key: "lost",
      label: "Status",
      value: (r) => (r.lost ? 1 : 0),
      numeric: true,
      render: (r) => <StatusCell state={linkState(Boolean(r.lost))} />,
    },
    { key: "first_seen", label: "First seen", value: (r) => r.first_seen, align: "right", render: (r) => shortDate(r.first_seen) },
  ];
  return (
    <DataTable
      rows={rows}
      columns={columns}
      initialSort="da"
      rowKey={(r, i) => `bl-${r.id ?? i}`}
      empty="No backlinks yet. Run a backlink sync — Common Crawl works with no API key."
      highlight={(r) => Boolean(focus) && hostOf(r.source) === focus}
    />
  );
}

export function ReviewsPanel({ rows }: { rows: any[] }) {
  const columns: Column<any>[] = [
    { key: "source", label: "Source", value: (r) => r.source },
    { key: "author", label: "Author", value: (r) => r.author ?? "—" },
    { key: "rating", label: "Rating", value: (r) => Number(r.rating) || null, numeric: true, align: "right" },
    {
      key: "sentiment",
      label: "Sentiment",
      value: (r) => (r.sentiment == null ? null : Number(r.sentiment)),
      numeric: true,
      align: "right",
      render: (r) => {
        if (r.sentiment == null) return "—";
        const v = Number(r.sentiment);
        // Sentiment is polarity, so it takes the diverging treatment: a
        // colour per side plus the signed number, never colour alone.
        const tone = v > 0.15 ? STATUS.good : v < -0.15 ? STATUS.critical : undefined;
        return <span style={tone ? { color: tone } : undefined}>{v.toFixed(2)}</span>;
      },
    },
    { key: "body", label: "Review", value: (r) => r.body ?? "", render: (r) => <span className="excerpt">{r.body || "—"}</span> },
    { key: "posted_at", label: "Posted", value: (r) => r.posted_at, align: "right", render: (r) => shortDate(r.posted_at) },
  ];
  return (
    <DataTable
      rows={rows}
      columns={columns}
      initialSort="posted_at"
      rowKey={(r, i) => `rv-${r.id ?? i}`}
      empty="No reviews yet. Add a Trustpilot, G2 or Google Business key in Settings."
    />
  );
}

export function CitationsPanel({ rows, focus }: { rows: any[]; focus?: string }) {
  const columns: Column<any>[] = [
    { key: "source", label: "Source", value: (r) => r.source, render: (r) => <a href={r.url} target="_blank" rel="noreferrer noopener">{r.source}</a> },
    { key: "kind", label: "Kind", value: (r) => r.kind ?? "—", render: (r) => <span className="pill">{r.kind ?? "—"}</span> },
    { key: "authority", label: "Authority", value: (r) => Number(r.authority) || null, numeric: true, align: "right" },
    { key: "discovered_at", label: "Discovered", value: (r) => r.discovered_at, align: "right", render: (r) => shortDate(r.discovered_at) },
  ];
  return (
    <DataTable
      rows={rows}
      columns={columns}
      initialSort="authority"
      rowKey={(r, i) => `ct-${r.id ?? i}`}
      empty="No citations yet. They are derived from backlinks — run a backlink sync, then a citation sync."
      highlight={(r) => Boolean(focus) && r.source === focus}
    />
  );
}
