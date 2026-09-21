/**
 * Lexicon sentiment scoring — pure and dependency-free so it runs on Termux
 * without pulling an ML runtime, and can be unit-tested in isolation.
 *
 * Returns a score in [-1, 1]. The heavier model lives in packages/analytics;
 * this is the fast path used at ingest time.
 */

const POSITIVE = [
  "excellent", "great", "love", "loved", "amazing", "perfect", "fantastic",
  "helpful", "reliable", "fast", "easy", "intuitive", "recommend", "best",
  "responsive", "smooth", "brilliant", "outstanding", "happy", "impressed",
];

const NEGATIVE = [
  "terrible", "awful", "hate", "hated", "broken", "slow", "buggy", "useless",
  "confusing", "expensive", "worst", "disappointed", "disappointing", "poor",
  "unreliable", "crash", "crashes", "refund", "scam", "frustrating",
];

const NEGATORS = ["not", "no", "never", "isn't", "wasn't", "don't", "didn't", "can't", "won't"];

/**
 * Scores review text. A negator immediately before a sentiment word flips its
 * polarity, so "not great" reads negative rather than positive.
 */
export function scoreSentiment(text: string | null | undefined): number {
  if (!text) return 0;
  const words = text.toLowerCase().match(/[a-z']+/g) ?? [];
  if (!words.length) return 0;

  let score = 0;
  let hits = 0;

  words.forEach((word, i) => {
    let value = 0;
    if (POSITIVE.includes(word)) value = 1;
    else if (NEGATIVE.includes(word)) value = -1;
    if (!value) return;

    const prev = words[i - 1];
    if (prev && NEGATORS.includes(prev)) value *= -1;

    score += value;
    hits++;
  });

  if (!hits) return 0;
  // Average over matched terms, then clamp — a long rant should not exceed -1.
  return Math.max(-1, Math.min(1, score / hits));
}

/**
 * Blends star rating with text sentiment when a rating is present. Ratings are
 * the stronger signal; the text breaks ties and catches sarcastic 5-stars.
 */
export function blendedSentiment(rating: number | null | undefined, text: string | null | undefined): number {
  const textScore = scoreSentiment(text);
  if (rating == null) return textScore;
  // Map a 1–5 star rating onto [-1, 1].
  const ratingScore = (rating - 3) / 2;
  return Math.max(-1, Math.min(1, ratingScore * 0.7 + textScore * 0.3));
}
