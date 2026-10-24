import type { McpRunSession } from "../types/mcp-run-session";

/**
 * A new, empty MCP session for one run (RNX-217), created before its tool schemas are built; no
 * document (RNX-222). RNX-276: it starts with no offered tool names — `executeTool` refuses every
 * tool until the run's schemas have been built into it.
 */
export function createMcpRunSession(): McpRunSession {
  return { connections: [], toolConnections: new Map(), offeredToolNames: new Set(), document: null };
}
