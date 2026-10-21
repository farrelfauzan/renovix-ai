// RNX-217: a local stdio MCP server for tests, started by the real McpClientService (StdioClientTransport) in place
// of a provider package. One per user: its owner and its record file come from the env the test hands over as that
// user's provider credentials. It appends one JSON line to the record file when it starts and one per tool call, so
// a test sees which server (and which process) answered whose call. It offers one tool, `whoami`, and never echoes
// its env. Never a real MCP server or key.
import { appendFileSync } from "node:fs";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";

const owner = process.env.MCP_STUB_OWNER;
const recordFile = process.env.MCP_STUB_RECORD_FILE;
const record = (entry) => appendFileSync(recordFile, `${JSON.stringify({ owner, pid: process.pid, ...entry })}\n`);

const server = new Server({ name: "rnx-217-stub", version: "1.0.0" }, { capabilities: { tools: {} } });
server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: "whoami",
      description: "Says whose MCP server answered",
      inputSchema: { type: "object", properties: { caller: { type: "string" } } },
    },
  ],
}));
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  record({ event: "call", tool: request.params.name, caller: request.params.arguments?.caller });
  return { content: [{ type: "text", text: `answered by ${owner}` }] };
});

await server.connect(new StdioServerTransport());
record({ event: "started" });
// A safety net for a run that never closes its connection (the code before RNX-217): exit after two minutes.
setTimeout(() => process.exit(0), 120_000).unref();
