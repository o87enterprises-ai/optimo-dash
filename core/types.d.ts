/**
 * Shared type layer for the SEO / AEO / GEO dashboard.
 *
 * Types only — no runtime values. It is a declaration file on purpose: a .ts
 * file here would be pulled into each consumer's compilation and emitted into
 * its dist/, shifting every output path. As a .d.ts it is erased entirely, so
 * there is no build step and no workspace resolution to configure.
 *
 * Consumers import it with `import type`, by relative path:
 *   import type { Site } from "../../../shared/types.ts";
 */

/* ---------- Core records ---------- */

export type Site = {
  id: number;
  domain: string;
  name: string | null;
  created_at: string;
};

export type Keyword = {
  id: number;
  site_id: number;
  keyword: string;
  position: number | null;
  impressions: number;
  clicks: number;
  country: string | null;
  device: string | null;
  updated_at: string;
};

export type GeoPrompt = {
  id: number;
  site_id: number;
  prompt: string;
  model: string;
  cited: boolean;
  excerpt: string | null;
  updated_at: string;
};

export type Backlink = {
  id: number;
  site_id: number;
  source: string;
  target: string;
  authority: number | null;
  anchor: string | null;
  domain_authority: number | null;
  first_seen: string;
  lost: boolean;
  created_at: string;
};

export type Review = {
  id: number;
  site_id: number;
  source: string;
  author: string | null;
  rating: number | null;
  body: string | null;
  sentiment: number | null;
  posted_at: string | null;
  url: string | null;
};

export type CitationKind = "gov" | "edu" | "journal" | "directory" | "social" | "other";

export type Citation = {
  id: number;
  site_id: number;
  source: string;
  url: string;
  authority: number | null;
  kind: CitationKind | null;
  verified: boolean;
  discovered_at: string;
};

export type RegionalMetricName = "clicks" | "impressions" | "rank" | "llm_citations";

export type RegionalMetric = {
  id: number;
  site_id: number;
  country: string;
  region: string | null;
  metric: RegionalMetricName;
  value: number | null;
  captured_at: string;
};

/* ---------- LLM visibility (GEO) ---------- */

export type LlmModel = "gpt-4o" | "claude-3.5" | "gemini-1.5" | "perplexity";

export type ProbeResult = {
  model: LlmModel;
  cited: boolean;
  excerpt: string;
  cached: boolean;
  error?: string;
};

export type ProbeRun = {
  runId: string;
  siteId: number;
  prompt: string;
  results: ProbeResult[];
};

/* ---------- Clone engine ---------- */

export type CloneGaps = {
  topics: string[];
  schema: string[];
  backlinks: string[];
  llmPrompts: string[];
};

export type CloneAction = {
  type: "content" | "schema" | "outreach" | "geo";
  title: string;
  priority: number;
  rationale: string;
};

export type CloneReport = {
  targetDomain: string;
  siteId: number;
  pagesAnalyzed: number;
  estimated: true;
  yourGaps: CloneGaps;
  recommendedActions: CloneAction[];
};

/* ---------- Debrief generator ---------- */

export type DebriefScope = "full" | "content" | "aeo" | "geo" | "regional";

export type DebriefPrompt = {
  id: string;
  category: string;
  title: string;
  prompt: string;
  inputs?: Record<string, unknown>;
};

export type Debrief = {
  summary: string;
  scope: DebriefScope;
  prompts: DebriefPrompt[];
};

/* ---------- Live stream ---------- */

export type StreamEvent = {
  kind: "keywords" | "geo_prompts" | "backlinks" | "reviews" | "citations" | "heartbeat";
  siteId?: number;
  at: string;
  payload?: unknown;
};

/* ---------- API envelopes ---------- */

export type Health = { ok: boolean; db: boolean; redis: boolean };

export type ConnectorStatus = {
  name: string;
  enabled: boolean;
  reason?: string;
};
