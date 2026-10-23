// Minimal, dependency-free <head> reader/editor for static HTML pages.
// Autopilot only ever touches the <head>; everything else is left byte-for-byte untouched.

export type HeadInfo = {
  hasHead: boolean;
  templated: boolean;
  lang: string | null;
  title: string | null;
  description: string | null;
  ogTitle: string | null;
  ogDescription: string | null;
  ogSiteName: string | null;
  canonical: string | null;
  robots: string | null;
  hasJsonLd: boolean;
  h1: string | null;
  paragraph: string | null;
  /** first stretch of readable body text, used as context for copywriting */
  excerpt: string | null;
};

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };

export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === "#") {
      const code = e[1].toLowerCase() === "x" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code < 0x110000 ? String.fromCodePoint(code) : m;
    }
    return ENTITIES[e.toLowerCase()] ?? m;
  });
}

const encodeText = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const encodeAttr = (s: string) => encodeText(s).replace(/"/g, "&quot;");

export function stripTags(s: string): string {
  return decodeEntities(
    s
      .replace(/<(script|style|noscript)[\s\S]*?<\/\1\s*>/gi, " ")
      .replace(/<!--[\s\S]*?-->/g, " ")
      .replace(/<[^>]+>/g, " ")
  )
    .replace(/\s+/g, " ")
    .trim();
}

type HeadRange = { open: number; start: number; end: number }; // start = just after <head>, end = index of </head>

function headRange(html: string): HeadRange | null {
  const open = /<head(\s[^>]*)?>/i.exec(html);
  if (!open) return null;
  const start = open.index + open[0].length;
  const close = /<\/head\s*>/i.exec(html.slice(start));
  if (!close) return null;
  return { open: open.index, start, end: start + close.index };
}

type Tag = { index: number; raw: string; attrs: Record<string, string> };

function parseAttrs(raw: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  const re = /([a-zA-Z_:][-a-zA-Z0-9_:.]*)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(raw))) attrs[m[1].toLowerCase()] = decodeEntities(m[2] ?? m[3] ?? "");
  return attrs;
}

function metaTags(head: string, offset: number): Tag[] {
  const tags: Tag[] = [];
  const re = /<meta\b[^>]*>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(head))) tags.push({ index: offset + m.index, raw: m[0], attrs: parseAttrs(m[0]) });
  return tags;
}

const TEMPLATE_MARKERS = /\{\{|\{%|<%|<\?|\$\{/;

export function readPage(html: string): HeadInfo {
  const range = headRange(html);
  const empty: HeadInfo = {
    hasHead: false, templated: false, lang: null, title: null, description: null, ogTitle: null,
    ogDescription: null, ogSiteName: null, canonical: null, robots: null, hasJsonLd: false, h1: null, paragraph: null, excerpt: null,
  };
  if (!range) return empty;
  const head = html.slice(range.start, range.end);
  const body = html.slice(range.end);
  const metas = metaTags(head, range.start);
  const meta = (attr: "name" | "property", key: string) =>
    metas.find((t) => t.attrs[attr]?.toLowerCase() === key)?.attrs.content ?? null;

  const titleTag = /<title[^>]*>([\s\S]*?)<\/title\s*>/i.exec(head);
  const canonical = /<link\b[^>]*rel\s*=\s*["']canonical["'][^>]*>/i.exec(head);
  const htmlTag = /<html\b[^>]*>/i.exec(html.slice(0, range.open + 1));

  const bodyClean = body.replace(/<(nav|header|footer|aside|script|style|noscript)\b[\s\S]*?<\/\1\s*>/gi, " ");
  const h1 = /<h1\b[^>]*>([\s\S]*?)<\/h1\s*>/i.exec(bodyClean);
  let paragraph: string | null = null;
  const pRe = /<p\b[^>]*>([\s\S]*?)<\/p\s*>/gi;
  let pm: RegExpExecArray | null;
  while ((pm = pRe.exec(bodyClean))) {
    const text = stripTags(pm[1]);
    if (text.length >= 60) { paragraph = text; break; }
  }

  return {
    hasHead: true,
    templated: TEMPLATE_MARKERS.test(head),
    lang: htmlTag ? parseAttrs(htmlTag[0]).lang ?? null : null,
    title: titleTag ? stripTags(titleTag[1]) : null,
    description: meta("name", "description"),
    ogTitle: meta("property", "og:title"),
    ogDescription: meta("property", "og:description"),
    ogSiteName: meta("property", "og:site_name"),
    canonical: canonical ? parseAttrs(canonical[0]).href ?? null : null,
    robots: meta("name", "robots"),
    hasJsonLd: /<script\b[^>]*type\s*=\s*["']application\/ld\+json["']/i.test(html),
    h1: h1 ? stripTags(h1[1]) || null : null,
    paragraph,
    excerpt: stripTags(bodyClean).slice(0, 800) || null,
  };
}

/* ---------- edits (head only) ---------- */

const eolOf = (html: string) => (html.includes("\r\n") ? "\r\n" : "\n");

function childIndent(html: string, range: HeadRange): string {
  const after = html.slice(range.start, range.end);
  const m = /\n([ \t]+)\S/.exec(after);
  return m ? m[1] : "  ";
}

function insertInHead(html: string, tag: string, afterMetaCharset: boolean): string {
  const range = headRange(html)!;
  const eol = eolOf(html);
  const indent = childIndent(html, range);
  if (afterMetaCharset) {
    const head = html.slice(range.start, range.end);
    const cs = /<meta\b[^>]*charset[^>]*>/i.exec(head);
    if (cs) {
      const at = range.start + cs.index + cs[0].length;
      return html.slice(0, at) + eol + indent + tag + html.slice(at);
    }
    return html.slice(0, range.start) + eol + indent + tag + html.slice(range.start);
  }
  // before </head>: keep the closing tag on its own line when it already is
  const lineStart = html.lastIndexOf("\n", range.end - 1) + 1;
  if (/^[ \t]*$/.test(html.slice(lineStart, range.end))) {
    return html.slice(0, lineStart) + indent + tag + eol + html.slice(lineStart);
  }
  return html.slice(0, range.end) + tag + html.slice(range.end);
}

export function setTitle(html: string, value: string): string {
  const range = headRange(html);
  if (!range) throw new Error("no <head>");
  const head = html.slice(range.start, range.end);
  const m = /(<title[^>]*>)([\s\S]*?)(<\/title\s*>)/i.exec(head);
  if (m) {
    const at = range.start + m.index;
    return html.slice(0, at) + m[1] + encodeText(value) + m[3] + html.slice(at + m[0].length);
  }
  return insertInHead(html, `<title>${encodeText(value)}</title>`, true);
}

export function setMeta(html: string, attr: "name" | "property", key: string, value: string): string {
  const range = headRange(html);
  if (!range) throw new Error("no <head>");
  const head = html.slice(range.start, range.end);
  const tag = metaTags(head, range.start).find((t) => t.attrs[attr]?.toLowerCase() === key);
  if (tag) {
    const hasContent = /\bcontent\s*=\s*(?:"[^"]*"|'[^']*')/i.test(tag.raw);
    const next = hasContent
      ? tag.raw.replace(/\bcontent\s*=\s*(?:"[^"]*"|'[^']*')/i, () => `content="${encodeAttr(value)}"`)
      : tag.raw.replace(/\s*\/?>$/, (end) => ` content="${encodeAttr(value)}"${end.trim() === "/>" ? " />" : ">"}`);
    return html.slice(0, tag.index) + next + html.slice(tag.index + tag.raw.length);
  }
  return insertInHead(html, `<meta ${attr}="${key}" content="${encodeAttr(value)}">`, false);
}

/** True when nothing outside <head> differs. This is the invariant every edit must satisfy. */
export function onlyHeadChanged(before: string, after: string): boolean {
  const a = headRange(before);
  const b = headRange(after);
  if (!a || !b) return false;
  return before.slice(0, a.start) === after.slice(0, b.start) && before.slice(a.end) === after.slice(b.end);
}
