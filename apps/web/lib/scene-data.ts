import { authorityColor, citedState, linkState, compact, magnitudeColor, position, rankColor } from "./viz";

/**
 * Turns API rows into the scene's node model.
 *
 * Kept separate from the renderer so the 3D scene and the 2D fallback draw
 * exactly the same data, and so the mapping can be tested without WebGL.
 */

export type SceneStat = { label: string; value: string; tone?: string; mark?: string };

export type SceneNode = {
  id: string;
  kind: "keyword" | "prompt" | "citation" | "backlink";
  kindLabel: string;
  title: string;
  shape: "octahedron" | "torus" | "tetrahedron" | "sphere";
  color: string;
  /** Relative size, already normalised to a sane range. */
  scale: number;
  /** 0–1, used for arc opacity. */
  magnitude?: number;
  glow?: boolean;
  lost?: boolean;
  stats: SceneStat[];
  /** Which panel tab to open when the node is clicked. */
  tab: string;
};

export type SceneData = {
  domain: string;
  keywords: SceneNode[];
  prompts: SceneNode[];
  citations: SceneNode[];
  backlinks: SceneNode[];
};

/** Caps how many nodes each ring draws, so a big site stays interactive. */
const RING_LIMIT = 40;

function scaleFrom(value: number, max: number, ceiling = 1.5): number {
  if (max <= 0) return 0.7;
  // Square root keeps one huge value from dwarfing everything else, and the
  // ceiling stops a single outlier filling the frame.
  return Math.min(ceiling, 0.55 + Math.sqrt(value / max) * 0.95);
}

export function buildSceneData(input: {
  domain: string;
  keywords: any[];
  prompts: any[];
  citations: any[];
  backlinks: any[];
}): SceneData {
  const maxImpressions = Math.max(1, ...input.keywords.map((k) => Number(k.impressions) || 0));
  const maxAuthority = Math.max(1, ...input.citations.map((c) => Number(c.authority) || 0));

  const keywords = input.keywords.slice(0, RING_LIMIT).map((k, i) => ({
    id: `kw-${k.id ?? i}`,
    kind: "keyword" as const,
    kindLabel: "Keyword",
    title: k.keyword,
    shape: "octahedron" as const,
    color: rankColor(k.position),
    scale: scaleFrom(Number(k.impressions) || 0, maxImpressions),
    stats: [
      { label: "Position", value: position(k.position) },
      { label: "Clicks", value: compact(k.clicks) },
      { label: "Impressions", value: compact(k.impressions) },
      { label: "Country", value: k.country ?? "—" },
    ],
    tab: "keywords",
  }));

  const prompts = input.prompts.slice(0, RING_LIMIT).map((p, i) => {
    const state = citedState(Boolean(p.cited));
    return {
      id: `gp-${p.id ?? i}`,
      kind: "prompt" as const,
      kindLabel: "LLM prompt",
      title: p.prompt,
      shape: "torus" as const,
      color: state.color,
      scale: 0.9,
      glow: Boolean(p.cited),
      stats: [
        { label: "Model", value: p.model },
        { label: "Status", value: state.label, tone: state.color, mark: state.mark },
        { label: "Checked", value: (p.updated_at ?? "").slice(0, 10) || "—" },
      ],
      tab: "geo",
    };
  });

  const citations = input.citations.slice(0, RING_LIMIT).map((c, i) => ({
    id: `ct-${c.id ?? i}`,
    kind: "citation" as const,
    kindLabel: "Citation",
    title: c.source,
    shape: "tetrahedron" as const,
    color: authorityColor(c.authority),
    scale: scaleFrom(Number(c.authority) || 0, maxAuthority, 1.25),
    stats: [
      { label: "Kind", value: c.kind ?? "—" },
      { label: "Authority", value: String(c.authority ?? "—") },
    ],
    tab: "citations",
  }));

  const backlinks = input.backlinks.slice(0, RING_LIMIT).map((b, i) => {
    const state = linkState(Boolean(b.lost));
    const authority = Number(b.domain_authority) || 0;
    return {
      id: `bl-${b.id ?? i}`,
      kind: "backlink" as const,
      kindLabel: "Backlink",
      title: hostOf(b.source),
      shape: "sphere" as const,
      // Blue ramp = magnitude everywhere in this scene; green and red are
      // reserved for state, so a backlink never wears the "cited" colour.
      color: b.lost ? state.color : magnitudeColor(authority / 100),
      scale: 0.6 + (authority / 100) * 0.8,
      magnitude: authority / 100,
      lost: Boolean(b.lost),
      stats: [
        { label: "Status", value: state.label, tone: state.color, mark: state.mark },
        { label: "Domain authority", value: authority ? String(authority) : "—" },
        { label: "Anchor", value: b.anchor || "—" },
      ],
      tab: "backlinks",
    };
  });

  return { domain: input.domain, keywords, prompts, citations, backlinks };
}

/** Hostname for display; falls back to the raw value when it will not parse. */
export function hostOf(url: string): string {
  try {
    return new URL(url.startsWith("http") ? url : `https://${url}`).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

/** Legend entries. Shape carries identity, so the legend must show shape too. */
export const SCENE_LEGEND = [
  { shape: "◆", label: "Keywords", detail: "brighter = better position, larger = more impressions" },
  { shape: "◍", label: "LLM prompts", detail: "glowing = cited by the model" },
  { shape: "▲", label: "Citations", detail: "brighter and larger = higher authority" },
  { shape: "●", label: "Backlinks", detail: "brighter = higher domain authority; amber = lost" },
] as const;
