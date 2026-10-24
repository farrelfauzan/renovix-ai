import type { McpRunSession } from "../types/mcp-run-session";
import type { ToolSchema } from "../types/tool-schema";

/**
 * RNX-276: records the offered tool names on the run's session, so `AgentToolService.executeTool` can
 * enforce them (a tool runs only when its name was offered to that run).
 */
export function rememberOfferedTools(
  mcpSession: McpRunSession | undefined,
  schemas: ToolSchema[],
): void {
  if (!mcpSession) return;
  for (const schema of schemas) mcpSession.offeredToolNames.add(schema.function.name);
}
