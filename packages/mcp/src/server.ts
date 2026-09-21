import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListResourcesRequestSchema,
  ListResourceTemplatesRequestSchema,
  ListToolsRequestSchema,
  ReadResourceRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";

/**
 * MCP server for the SEO / AEO / GEO dashboard.
 *
 * Every tool is a thin, typed wrapper over the REST API, so an agent and the
 * GUI always see identical data and there is one place where business logic
 * lives. Runs over stdio: `pnpm mcp:serve`.
 */

const API = process.env.API_URL || "http://localhost:4000";

/** Calls the dashboard API and surfaces its error text rather than a bare status. */
async function api(path: string, init?: RequestInit): Promise<unknown> {
  const res = await fetch(`${API}${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
  });
  const text = await res.text();
  let body: any;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  if (!res.ok) {
    throw new Error(body?.error ?? `${res.status} ${res.statusText}`);
  }
  return body;
}

/* ---------- Tools ---------- */

type ToolDef = {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  run: (args: any) => Promise<unknown>;
};

const siteIdSchema = {
  type: "object",
  properties: { siteId: { type: "number", description: "Site id from list_sites" } },
  required: ["siteId"],
} as const;

const TOOLS: ToolDef[] = [
  {
    name: "list_sites",
    description: "List every site tracked by the dashboard, with id, domain and creation date.",
    inputSchema: { type: "object", properties: {} },
    run: () => api("/api/sites"),
  },
  {
    name: "get_live_rankings",
    description:
      "Keyword rankings for a site: position, clicks, impressions, country and device. Sorted best position first.",
    inputSchema: siteIdSchema,
    run: ({ siteId }) => api(`/api/sites/${siteId}/rank`),
  },
  {
    name: "get_llm_visibility",
    description:
      "LLM citation visibility for a site: overall percentage, a per-model breakdown, and every tracked prompt with the answer excerpt showing whether the domain was cited.",
    inputSchema: siteIdSchema,
    run: ({ siteId }) => api(`/api/sites/${siteId}/geo`),
  },
  {
    name: "list_backlinks",
    description: "Backlinks for a site with anchor text, domain authority, and whether the link was lost.",
    inputSchema: siteIdSchema,
    run: ({ siteId }) => api(`/api/sites/${siteId}/backlinks`),
  },
  {
    name: "run_geo_prompt",
    description:
      "Ask the configured LLMs a real user question and record whether they cite the site's domain. Costs money: each enabled model is called once unless the answer is already cached (24h). Returns one result per model.",
    inputSchema: {
      type: "object",
      properties: {
        siteId: { type: "number", description: "Site id from list_sites" },
        prompt: { type: "string", description: 'The user question, e.g. "best crm for startups"' },
        models: {
          type: "array",
          items: { type: "string", enum: ["gpt-4o", "claude-3.5", "gemini-1.5", "perplexity"] },
          description: "Optional subset of models. Defaults to every model with an API key configured.",
        },
      },
      required: ["siteId", "prompt"],
    },
    run: ({ siteId, prompt, models }) =>
      api(`/api/sites/${siteId}/prompts`, {
        method: "POST",
        body: JSON.stringify({ prompt, models }),
      }),
  },
  {
    name: "clone_strategy",
    description:
      "Reverse-engineer a competitor's public SEO/AEO strategy from free data (their sitemap, pages and schema) and return the content, schema, backlink and LLM-citation gaps against your own site, plus prioritised actions. All figures are estimates.",
    inputSchema: {
      type: "object",
      properties: {
        siteId: { type: "number", description: "Your site id" },
        targetDomain: { type: "string", description: "Competitor domain, e.g. competitor.com" },
      },
      required: ["siteId", "targetDomain"],
    },
    run: ({ siteId, targetDomain }) =>
      api("/api/clone", { method: "POST", body: JSON.stringify({ siteId, targetDomain }) }),
  },
  {
    name: "generate_debrief",
    description:
      "Turn the site's findings into copy-ready, self-contained prompts for an agency or another LLM. Each prompt embeds the site's real data plus constraints, output format and success criteria.",
    inputSchema: {
      type: "object",
      properties: {
        siteId: { type: "number" },
        scope: {
          type: "string",
          enum: ["full", "content", "aeo", "geo", "regional"],
          description: "Which area to brief. Defaults to full.",
        },
        targetAudience: { type: "string", description: 'e.g. "early-stage SaaS founders"' },
        tone: { type: "string" },
        country: { type: "string", description: "ISO-3166 alpha-2, for regional scope" },
      },
      required: ["siteId"],
    },
    run: ({ siteId, ...body }) =>
      api(`/api/sites/${siteId}/debrief`, { method: "POST", body: JSON.stringify(body) }),
  },
];

/* ---------- Resources ---------- */

const STATIC_RESOURCES = [
  {
    uri: "site://list",
    name: "Tracked sites",
    description: "Every site in the dashboard",
    mimeType: "application/json",
  },
];

const RESOURCE_TEMPLATES = [
  {
    uriTemplate: "site://{id}/summary",
    name: "Site summary",
    description: "Headline SEO, GEO, backlink, review and citation counts for one site",
    mimeType: "application/json",
  },
  {
    uriTemplate: "site://{id}/geo",
    name: "Site LLM visibility",
    description: "Per-model LLM citation breakdown for one site",
    mimeType: "application/json",
  },
];

/** Maps a site:// URI onto the REST endpoint that serves it. */
async function readResource(uri: string): Promise<unknown> {
  if (uri === "site://list") return api("/api/sites");

  const match = /^site:\/\/(\d+)\/(summary|geo)$/.exec(uri);
  if (match) return api(`/api/sites/${match[1]}/${match[2]}`);

  throw new Error(`unknown resource: ${uri}`);
}

/* ---------- Wiring ---------- */

const server = new Server(
  { name: "seo-aeo-geo", version: "0.1.0" },
  { capabilities: { tools: {}, resources: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: TOOLS.map(({ name, description, inputSchema }) => ({ name, description, inputSchema })),
}));

server.setRequestHandler(CallToolRequestSchema, async (req) => {
  const tool = TOOLS.find((t) => t.name === req.params.name);
  if (!tool) {
    return {
      isError: true,
      content: [{ type: "text" as const, text: `Unknown tool: ${req.params.name}` }],
    };
  }

  try {
    const result = await tool.run(req.params.arguments ?? {});
    return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
  } catch (e: any) {
    // Report failures to the agent as tool errors so it can recover, rather
    // than as protocol errors that abort the conversation.
    return {
      isError: true,
      content: [
        {
          type: "text" as const,
          text: `${tool.name} failed: ${e.message}\n\nIs the API running at ${API}? Start it with: pnpm --filter api dev`,
        },
      ],
    };
  }
});

server.setRequestHandler(ListResourcesRequestSchema, async () => ({ resources: STATIC_RESOURCES }));

server.setRequestHandler(ListResourceTemplatesRequestSchema, async () => ({
  resourceTemplates: RESOURCE_TEMPLATES,
}));

server.setRequestHandler(ReadResourceRequestSchema, async (req) => {
  const contents = await readResource(req.params.uri);
  return {
    contents: [
      { uri: req.params.uri, mimeType: "application/json", text: JSON.stringify(contents, null, 2) },
    ],
  };
});

const transport = new StdioServerTransport();
await server.connect(transport);
// stdout carries the protocol, so diagnostics must go to stderr.
console.error(`seo-aeo-geo MCP server ready (API: ${API})`);
