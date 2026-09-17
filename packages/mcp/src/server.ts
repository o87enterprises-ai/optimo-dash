import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

const server = new Server(
  { name: "seo-aeo-geo", version: "0.1.0" },
  { capabilities: { tools: {}, resources: {} } }
);

server.setRequestHandler("tools/list" as any, async () => ({
  tools: [
    { name: "get_live_rankings", description: "Fetch live keyword rankings" },
    { name: "get_llm_visibility", description: "Check LLM citation visibility" },
    { name: "list_backlinks", description: "List backlinks for a domain" },
    { name: "get_reviews", description: "Fetch reviews across platforms" }
  ]
}));

server.setRequestHandler("tools/call" as any, async (req: any) => {
  return { content: [{ type: "text", text: `Tool ${req.params.name} invoked` }] };
});

const transport = new StdioServerTransport();
await server.connect(transport);
