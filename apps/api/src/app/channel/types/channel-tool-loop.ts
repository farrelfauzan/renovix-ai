import type { ModelConfig } from "../../config/model-registry.service";
import type { ModelConnection } from "../../providers/types/model-connection";
import type { ChannelService } from "../service/channel.service";
import type { McpRunSession } from "../../agent/types/mcp-run-session";

/**
 * What the tool loop of one channel chat message works on (RX-22b): the caller, the channel agent, its model, the
 * prompt and the run's MCP session.
 */
export type ChannelToolLoop = {
  readonly userId: string;
  readonly channelId: string;
  readonly agentId: string;
  readonly message: string;
  readonly channelAgent: Awaited<ReturnType<ChannelService["resolveChannelAgent"]>>;
  readonly modelEntry: ModelConfig;
  readonly connection: ModelConnection;
  readonly currentMessages: any[];
  readonly toolSchemas: any[];
  /** RNX-217: the run's own MCP connections, the only ones its tool calls use. */
  readonly mcpSession: McpRunSession;
  readonly maxTokens: number;
};
