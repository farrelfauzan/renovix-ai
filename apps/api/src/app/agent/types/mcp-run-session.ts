import type { McpConnection } from "../../mcp/types/mcp-connection";

/**
 * The MCP connections of one run (RNX-217): every connection the run opened, and which of them serves each MCP tool
 * name the model was offered. One per run, never shared between runs; the run closes it in a `finally`
 * (AgentToolService.cleanupMcpConnections).
 */
export type McpRunSession = {
  readonly connections: McpConnection[];
  readonly toolConnections: Map<string, McpConnection>;
};
