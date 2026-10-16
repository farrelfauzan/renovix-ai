import type { McpToolSchema } from "../service/mcp-client.service";

/**
 * Convert MCP tool schema to OpenAI function-calling format
 */
export function mcpToolToOpenAI(mcpTool: McpToolSchema): {
  type: "function";
  function: { name: string; description: string; parameters: any };
} {
  return {
    type: "function",
    function: {
      name: mcpTool.name,
      description: mcpTool.description || "",
      parameters: mcpTool.inputSchema || { type: "object", properties: {} },
    },
  };
}
