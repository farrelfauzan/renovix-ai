import type { McpRunSession } from "../types/mcp-run-session";

/** A new, empty MCP session for one run (RNX-217), created before its tool schemas are built; no document (RNX-222). */
export function createMcpRunSession(): McpRunSession {
  return { connections: [], toolConnections: new Map(), document: null };
}
