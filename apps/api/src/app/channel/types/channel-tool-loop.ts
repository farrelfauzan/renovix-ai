import type { ModelConfig } from "../../config/model-registry.service";
import type { ModelConnection } from "../../providers/types/model-connection";
import type { ChannelService } from "../service/channel.service";

/** What the tool loop of one channel chat message works on (RX-22b): the caller, the channel agent, its model and the prompt. */
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
  readonly maxTokens: number;
};
