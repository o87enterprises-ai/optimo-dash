# Autopilot (phase 1: safe edits in review mode)

Open **/autopilot** in the web dashboard. Autopilot reads a site's static HTML pages from GitHub, finds weak
titles, meta descriptions and social tags, writes better ones, and proposes them as a **pull request**.
Nothing goes live until the pull request is published (merged), and every publish can be undone.

## Try it with no setup

Pick **Demo site**. It is a made-up dental practice held in the browser tab, so you can scan, approve,
publish and undo without a repo or a token. Refreshing resets it.

## Use a real repo

1. Choose **My GitHub repo**, enter `owner/name`.
2. Create a [fine-grained token](https://github.com/settings/personal-access-tokens/new) for that one repository
   with **Contents** and **Pull requests** set to read and write. Public repos can be scanned without a token.
3. **Scan site**, tick the pages you want, **Create pull request**, then **Publish** (or review the PR on GitHub first).

The token stays in the browser tab and is sent only to `api.github.com`; Optimo's server never sees it.
(Production replaces the token with a GitHub App install: one click, one repo, revocable.)

Works today on **static HTML** repos. Framework sources (Next.js, Astro, ...) are detected and reported as not yet supported.

## AI copy (provider-agnostic)

Copy is written through the same provider layer the GEO probes use (`apps/api/src/probes/providers.ts`):
NVIDIA, Groq, Gemini, Ollama (local or cloud), or any OpenAI-compatible endpoint. Without a key the built-in rules write the copy.

- **Keys on the server:** set them in `.env` (local) or the host's environment (see `.env.example`), e.g. `GROQ_API_KEY`,
  `NVIDIA_API_KEY`, `GOOGLE_AI_API_KEY`, or `LLM_PROVIDER_<NAME>_BASE_URL` / `_MODEL` / `_API_KEY` for anything else.
- **Keys in the browser:** on the page, pick NVIDIA, Groq, Gemini or Ollama cloud and paste a key. It is used for that
  tab only and is never stored. The server never accepts a base URL from a request.
- **Public deployments:** when deployed on Vercel, server-side keys are **not** used unless `AUTOPILOT_ACCESS_KEY` is set;
  visitors then need to enter that code. This stops strangers spending your free-tier keys.
- Use **Test connection** to verify a key end to end.

Every AI suggestion is validated before use: it must fit the length limits and may not introduce numbers, links or
emails that are not on the page. Anything rejected falls back to the built-in copy.

## Guardrails

- Only the `<head>` is edited; the rest of the page is checked to be byte-for-byte unchanged, and edits are read back.
- Never writes to the default branch: every change is a pull request on an `optimo/` branch.
- At most 5 pages per run; `noindex` pages, templates and partials are skipped.
- Acts only on its own pull requests; a page edited by someone else after the scan is left alone.
- **Undo** opens a pull request that restores the earlier content (skipping files edited since).
- The pull-request list is the audit log, including whether rules or an AI wrote each field.
- Canonical links, structured data, headings and language tags are listed as "needs a person" and never changed.

## Code

`apps/web/lib/autopilot/`: `html.ts` (head reader/editor), `rules.ts` (checks and copy rules), `engine.ts`
(scan, propose, publish, undo, history), `repo.ts` + `github.ts` + `memory.ts` (code-host interface, GitHub, demo),
`ai.ts` (prompts and validation), `server.ts` (provider access). Tests: `pnpm --filter web test`.
