import { checkCopy, CopyRequest, CopyResult } from "./ai";

export type Failure = { provider: string; error: string };

/** Boil a provider's raw HTTP error down to the sentence a person needs. */
export function briefError(raw: string): string {
  const m = /^HTTP (\d{3}):\s*([\s\S]*)$/.exec(raw);
  if (!m) return raw.replace(/\s+/g, " ").slice(0, 200);
  const status = Number(m[1]);
  let detail = m[2];
  try {
    const j = JSON.parse(m[2]);
    detail = j.detail || j.error?.message || j.message || j.error || j.title || detail;
  } catch {}
  detail = String(detail).replace(/\s+/g, " ").slice(0, 180);
  const hint = (status === 404 || status === 410) && /model/i.test(detail) ? " Choose this provider above and use List models to pick a current one." : "";
  if (status === 401 || status === 403) return `the key was rejected (HTTP ${status}).`;
  if (status === 429) return "rate limit reached (HTTP 429).";
  return `HTTP ${status}: ${detail}${hint}`;
}

/**
 * Ask the providers in order. When one fails (retired model, bad key, rate limit, outage) the next one takes over
 * for the rest of the run. A reply that fails validation is not a provider failure, so it does not trigger a switch.
 */
export async function copyWithFallback(
  providers: string[],
  pages: CopyRequest[],
  run: (provider: string, page: CopyRequest) => Promise<string>
): Promise<{ results: CopyResult[]; failures: Failure[] }> {
  const failures: Failure[] = [];
  const results: CopyResult[] = [];
  let i = 0;
  let last = "no AI provider is available";
  for (const page of pages) {
    let done = false;
    while (i < providers.length && !done) {
      const id = providers[i];
      try {
        results.push({ ...checkCopy(page, await run(id, page)), provider: id });
        done = true;
      } catch (e: any) {
        last = briefError(String(e?.message ?? e));
        failures.push({ provider: id, error: last });
        i++;
      }
    }
    if (!done) results.push({ path: page.path, error: last });
  }
  return { results, failures };
}
