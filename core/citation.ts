/**
 * Citation detection — pure, dependency-free so it can be unit-tested without
 * a database or network.
 */

const EXCERPT_RADIUS = 200;

/**
 * Finds the domain in an answer and returns the surrounding text.
 *
 * Matches the bare domain and common decorations (www., https://, markdown
 * links), but not a domain that is merely a substring of a longer host —
 * "notexample.com" must not count as a citation of "example.com", and neither
 * must "example.community".
 */
export function detectCitation(
  answer: string,
  domain: string,
  aliases: string[] = []
): { cited: boolean; excerpt: string } {
  const needles = [domain, ...aliases].filter(Boolean).map((d) => d.toLowerCase());
  const hay = answer.toLowerCase();

  for (const needle of needles) {
    const escaped = needle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    // Reject a neighbouring label character on either side, while still
    // allowing ://, www. and ordinary punctuation to sit next to the match.
    const re = new RegExp(`(?<![a-z0-9-])${escaped}(?![a-z0-9-])`, "i");
    const m = re.exec(hay);
    if (m) {
      const start = Math.max(0, m.index - EXCERPT_RADIUS);
      const end = Math.min(answer.length, m.index + needle.length + EXCERPT_RADIUS);
      const prefix = start > 0 ? "…" : "";
      const suffix = end < answer.length ? "…" : "";
      return { cited: true, excerpt: `${prefix}${answer.slice(start, end).trim()}${suffix}` };
    }
  }

  // Not cited: keep the opening of the answer so the user can see what the
  // model recommended instead, which is the actionable part of a miss.
  return { cited: false, excerpt: answer.slice(0, EXCERPT_RADIUS * 2).trim() };
}
