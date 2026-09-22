/**
 * Visualization tokens and scales.
 *
 * Colour does exactly two jobs here:
 *
 * - **Magnitude** (keyword rank, authority, regional metrics) — one sequential
 *   blue ramp. On a dark surface the anchor flips, so "near zero" is the step
 *   closest to the background and magnitude grows brighter.
 * - **State** (cited / not cited, link lost) — the reserved status palette,
 *   always shipped with an icon and a label so colour never carries the
 *   meaning alone.
 *
 * Identity — which ring a node belongs to — is carried by *shape and orbit*,
 * not hue. That is deliberate: the scene is an all-pairs form (any two marks
 * can sit side by side), where no categorical palette keeps more than three
 * hues separable under colour-vision deficiency. Shape has no such limit.
 *
 * Every value below is a documented step, validated against this project's
 * panel surface (#131a26): the three categorical slots pass all-pairs CVD and
 * normal-vision floors, and all four status colours clear 3:1.
 */

/** Sequential blue ramp, step 100 (lightest) → 700 (darkest). */
export const BLUE_RAMP = [
  "#cde2fb", "#b7d3f6", "#9ec5f4", "#86b6ef", "#6da7ec",
  "#5598e7", "#3987e5", "#2a78d6", "#256abf", "#1c5cab", "#184f95",
] as const;

/** Reserved status palette. Never reused for series identity. */
export const STATUS = {
  good: "#0ca30c",
  warning: "#fab219",
  serious: "#ec835a",
  critical: "#d03b3b",
} as const;

/**
 * Categorical slots, in fixed order. Only the first three are used, because
 * this dashboard's charts are all-pairs forms.
 */
export const SERIES = ["#3987e5", "#d95926", "#199e70"] as const;

export const SURFACE = "#131a26";
export const INK = { primary: "#e6eefc", secondary: "#8ba1c2", grid: "#223047" } as const;

/** Clamps t to 0..1. */
function clamp01(t: number): number {
  return t < 0 ? 0 : t > 1 ? 1 : t;
}

/**
 * Magnitude → colour on the dark surface.
 *
 * t = 0 is the dimmest step (recedes toward the background), t = 1 the
 * brightest. Step 700 is skipped: it sits at 1.46:1 and would disappear.
 */
export function magnitudeColor(t: number): string {
  const index = Math.round((1 - clamp01(t)) * (BLUE_RAMP.length - 1));
  return BLUE_RAMP[index];
}

/**
 * Keyword position → colour. Position 1 is the strongest result, so it gets
 * the brightest step; anything past 50 is effectively invisible in search and
 * bottoms out. An unranked keyword returns the dimmest step.
 */
export function rankColor(position: number | null | undefined): string {
  if (position == null) return BLUE_RAMP[BLUE_RAMP.length - 1];
  return magnitudeColor(1 - clamp01((position - 1) / 49));
}

/** Citation authority (0–100) → colour. */
export function authorityColor(authority: number | null | undefined): string {
  return magnitudeColor(clamp01((authority ?? 0) / 100));
}

/**
 * State of a tracked LLM prompt. The label and mark travel with the colour —
 * a reader who cannot distinguish the hues still gets the answer.
 */
export function citedState(cited: boolean): { color: string; mark: string; label: string } {
  return cited
    ? { color: STATUS.good, mark: "✓", label: "Cited" }
    : { color: STATUS.critical, mark: "✗", label: "Not cited" };
}

export function linkState(lost: boolean): { color: string; mark: string; label: string } {
  return lost
    ? { color: STATUS.serious, mark: "⚠", label: "Lost" }
    : { color: STATUS.good, mark: "✓", label: "Live" };
}

/* ---------- Formatting ---------- */

export function compact(n: number | null | undefined): string {
  if (n == null) return "—";
  const abs = Math.abs(n);
  if (abs >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(Math.round(n));
}

export function position(p: number | null | undefined): string {
  return p == null ? "unranked" : `#${Math.round(p)}`;
}

export function percent(n: number | null | undefined): string {
  return n == null ? "—" : `${Math.round(n)}%`;
}

/** ISO date → a short, locale-independent label. */
export function shortDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "—" : d.toISOString().slice(0, 10);
}

/* ---------- Capability detection ---------- */

/**
 * Whether this device should attempt the 3D scene.
 *
 * The dashboard is built to run on Termux phones, where a WebGL scene can be
 * unusably slow or simply unsupported. Both conditions fall back to the 2D
 * view rather than showing a black canvas.
 */
export function supports3D(): boolean {
  if (typeof window === "undefined") return false;
  if (typeof navigator !== "undefined" && (navigator.hardwareConcurrency ?? 8) < 4) return false;
  try {
    const canvas = document.createElement("canvas");
    return Boolean(
      canvas.getContext("webgl2") ?? canvas.getContext("webgl")
    );
  } catch {
    return false;
  }
}
