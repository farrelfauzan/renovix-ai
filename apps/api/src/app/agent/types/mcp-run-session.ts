import type { McpConnection } from "../../mcp/types/mcp-connection";
import type { StoredDocumentResult } from "../../document/service/document.service";

/**
 * The MCP connections of one run (RNX-217): every connection the run opened, and which of them serves each MCP tool
 * name the model was offered. One per run, never shared between runs; the run closes it in a `finally`
 * (AgentToolService.cleanupMcpConnections). RNX-222: it also holds the document the run's `create_document` call
 * generated (null until then), so the run's own result carries it and no other run's does.
 */
export type McpRunSession = {
  readonly connections: McpConnection[];
  readonly toolConnections: Map<string, McpConnection>;
  /**
   * RNX-276: the names of every tool schema offered to this run (built-ins, call_agent, MCP tools).
   * `executeTool` runs a tool only when its name is here: a built-in the run never offered must
   * not run, whoever asks for it (a user message, knowledge content or a web page steering the model).
   */
  readonly offeredToolNames: Set<string>;
  document: StoredDocumentResult | null;
};
