import { HeadInfo, onlyHeadChanged, readPage, setMeta, setTitle } from "./html";

export const LIMITS = {
  titleMin: 15,
  titleMax: 60,
  descMin: 70,
  descMax: 160,
  descTarget: 155,
  maxPagesPerRun: 5,
  maxFileBytes: 500_000,
  maxFilesRead: 60,
};

export type Field = "title" | "description" | "og:title" | "og:description";

export type FieldEdit = {
  field: Field;
  before: string | null;
  after: string;
  reason: string;
  /** "rules" for the built-in copy, otherwise the AI provider that wrote it */
  source: string;
};

export type PageContext = {
  h1: string | null;
  excerpt: string | null;
  title: string | null;
  description: string | null;
};

export type PageProposal = {
  path: string;
  edits: FieldEdit[];
  priority: number; // lower = more important
  notes: string[]; // things a human has to decide; never auto-edited
  context: PageContext;
  /** title as it will read after the edits; used to spot duplicates across pages */
  finalTitle: string | null;
};

const SEP = /\s+[|–—-]\s+/;

const squash = (s: string) => s.replace(/\s+/g, " ").trim();

function cutAtWord(s: string, max: number): string {
  if (s.length <= max) return s;
  const cut = s.slice(0, max + 1);
  const at = cut.lastIndexOf(" ");
  return (at > max * 0.6 ? cut.slice(0, at) : s.slice(0, max)).replace(/[\s,;:|–—-]+$/, "");
}

export function shortenTitle(title: string, max = LIMITS.titleMax): string {
  let t = squash(title);
  if (t.length <= max) return t;
  const parts = t.split(SEP);
  if (parts.length > 1) {
    const joiner = " | ";
    const withBrand = `${parts[0]}${joiner}${parts[parts.length - 1]}`;
    t = withBrand.length <= max ? withBrand : parts[0];
  }
  return cutAtWord(t, max);
}

export function brandTitle(primary: string, siteName: string | null, max = LIMITS.titleMax): string {
  const base = squash(primary);
  if (!siteName || base.toLowerCase().includes(siteName.toLowerCase())) return shortenTitle(base, max);
  const full = `${base} | ${siteName}`;
  return full.length <= max ? full : shortenTitle(base, max);
}

export function summarize(text: string, max = LIMITS.descTarget): string {
  const t = squash(text);
  if (t.length <= max) return t;
  const window = t.slice(0, max);
  const sentence = Math.max(window.lastIndexOf(". "), window.lastIndexOf("! "), window.lastIndexOf("? "));
  if (sentence >= LIMITS.descMin) return window.slice(0, sentence + 1);
  return `${cutAtWord(t, max - 1)}…`;
}

const humanize = (path: string) =>
  path.replace(/^.*\//, "").replace(/\.html?$/i, "").replace(/[-_]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());

export type Ctx = { siteName: string | null };

/** Returns null when the page should be skipped; reason in `skipReason`. */
export function skipReason(info: HeadInfo): string | null {
  if (!info.hasHead) return "no <head> (a partial or template)";
  if (info.templated) return "head contains template code, so edits are not safe";
  if (info.robots && /noindex/i.test(info.robots)) return "marked noindex";
  return null;
}

export function analyzePage(path: string, html: string, ctx: Ctx): PageProposal | { skipped: string } {
  const info = readPage(html);
  const skip = skipReason(info);
  if (skip) return { skipped: skip };

  const edits: FieldEdit[] = [];
  const notes: string[] = [];
  let priority = 9;

  // ----- title
  let finalTitle = info.title;
  if (!info.title) {
    const after = brandTitle(info.h1 || humanize(path), ctx.siteName);
    edits.push({ field: "title", before: null, after, reason: "The page has no title, so search engines make one up.", source: "rules" });
    finalTitle = after;
    priority = Math.min(priority, 1);
  } else if (info.title.length > LIMITS.titleMax) {
    const after = shortenTitle(info.title);
    if (after !== info.title) {
      edits.push({ field: "title", before: info.title, after, reason: `Longer than ${LIMITS.titleMax} characters, so Google cuts it off in results.`, source: "rules" });
      finalTitle = after;
      priority = Math.min(priority, 3);
    }
  } else if (info.title.length < LIMITS.titleMin && info.h1 && info.h1 !== info.title) {
    const after = brandTitle(info.h1, ctx.siteName);
    if (after !== info.title && after.length >= LIMITS.titleMin) {
      edits.push({ field: "title", before: info.title, after, reason: "Too short to say what the page is about.", source: "rules" });
      finalTitle = after;
      priority = Math.min(priority, 3);
    }
  }

  // ----- description
  let finalDesc = info.description;
  const d = info.description;
  if (!d || d.length < LIMITS.descMin) {
    if (info.paragraph) {
      const after = summarize(info.paragraph);
      if (after !== d && after.length >= 30) {
        edits.push({
          field: "description", before: d, after,
          reason: d ? "Too short to be useful in results." : "No description, so Google picks random text from the page.",
          source: "rules",
        });
        finalDesc = after;
        priority = Math.min(priority, d ? 4 : 2);
      }
    } else {
      notes.push("Needs a meta description, but there is no body text to base one on.");
    }
  } else if (d.length > LIMITS.descMax) {
    const after = summarize(d);
    edits.push({ field: "description", before: d, after, reason: `Longer than ${LIMITS.descMax} characters, so it gets cut off.`, source: "rules" });
    finalDesc = after;
    priority = Math.min(priority, 4);
  }

  // ----- social preview tags (only added when missing)
  if (!info.ogTitle && finalTitle) {
    edits.push({ field: "og:title", before: null, after: finalTitle, reason: "Controls the headline when the page is shared on social apps and chat.", source: "rules" });
    priority = Math.min(priority, 6);
  }
  if (!info.ogDescription && finalDesc) {
    edits.push({ field: "og:description", before: null, after: finalDesc, reason: "Controls the summary when the page is shared on social apps and chat.", source: "rules" });
    priority = Math.min(priority, 6);
  }

  // ----- things we flag but never change on our own
  if (!info.h1) notes.push("No main heading (h1) found.");
  if (!info.canonical) notes.push("No canonical link; adding one needs the site's final web address.");
  if (!info.hasJsonLd) notes.push("No structured data (schema); needs facts only the business owner can confirm.");
  if (!info.lang) notes.push("The <html> tag has no language attribute.");

  return {
    path, edits, priority, notes, finalTitle,
    context: { h1: info.h1, excerpt: info.excerpt, title: info.title, description: info.description },
  };
}

export function applyEdits(html: string, edits: FieldEdit[]): string {
  let out = html;
  for (const e of edits) {
    if (e.field === "title") out = setTitle(out, e.after);
    else if (e.field === "description") out = setMeta(out, "name", "description", e.after);
    else if (e.field === "og:title") out = setMeta(out, "property", "og:title", e.after);
    else out = setMeta(out, "property", "og:description", e.after);
  }
  if (!onlyHeadChanged(html, out)) throw new Error("refusing edit: it would change content outside <head>");
  // re-read to prove the result says what we intended
  const check = readPage(out);
  for (const e of edits) {
    const got =
      e.field === "title" ? check.title
      : e.field === "description" ? check.description
      : e.field === "og:title" ? check.ogTitle
      : check.ogDescription;
    if (got !== e.after) throw new Error(`refusing edit: ${e.field} did not read back as intended`);
  }
  return out;
}

export function fieldValue(info: HeadInfo, field: Field): string | null {
  return field === "title" ? info.title
    : field === "description" ? info.description
    : field === "og:title" ? info.ogTitle
    : info.ogDescription;
}

/* ---------- copy validation (used for every AI-written suggestion) ---------- */

const FACTS = /https?:\/\/\S+|[\w.+-]+@[\w-]+\.[\w.]+|\d[\d,.]*/g;

/**
 * An AI suggestion is only accepted when it fits the length limits and does not introduce
 * numbers, links or emails that the page itself does not contain.
 */
export function validateCopy(field: "title" | "description", text: string, source: string): string | null {
  if (!text || /[\r\n]/.test(text)) return "empty or multi-line";
  const t = squash(text);
  if (field === "title" && (t.length < LIMITS.titleMin || t.length > LIMITS.titleMax)) {
    return `title must be ${LIMITS.titleMin}-${LIMITS.titleMax} characters (got ${t.length})`;
  }
  if (field === "description" && (t.length < LIMITS.descMin || t.length > LIMITS.descMax)) {
    return `description must be ${LIMITS.descMin}-${LIMITS.descMax} characters (got ${t.length})`;
  }
  const hay = source.toLowerCase();
  for (const fact of t.match(FACTS) ?? []) {
    if (!hay.includes(fact.toLowerCase().replace(/[.,]+$/, ""))) return `introduces "${fact}", which is not on the page`;
  }
  return null;
}
