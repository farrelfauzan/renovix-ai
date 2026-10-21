import type { ModelConfig } from "../../config/model-registry.service";
import type { ModelConnection } from "../../providers/types/model-connection";
import type { McpRunSession } from "../../agent/types/mcp-run-session";

/** What the tool loop of one reminder run works on (RX-22b): the due reminder, its chat room, the agent's model and the prompt. */
export type ReminderToolLoop = {
  readonly reminder: any;
  readonly chatRoom: { readonly id: string };
  readonly modelEntry: ModelConfig;
  readonly connection: ModelConnection;
  readonly messages: any[];
  readonly toolSchemas: any[];
  /** RNX-217: the run's own MCP connections, the only ones its tool calls use. */
  readonly mcpSession: McpRunSession;
};
