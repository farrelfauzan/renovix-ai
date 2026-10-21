import type { McpRunSession } from "../types/mcp-run-session";

/** A new, empty MCP session for one run (RNX-217), created before its tool schemas are built. */
export function createMcpRunSession(): McpRunSession {
  return { connections: [], toolConnections: new Map() };
}
