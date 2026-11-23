import { Logger } from "@nestjs/common";
import { errorName } from "../../../common/utils/error-name";
import { ChatEnginePersistence } from "../../chat-engine/ports/chat-engine-persistence.port";
import type { ChatExchangeRecord } from "../../chat-engine/types/chat-exchange-record";
import type { AgentMemoryService } from "../../agent/service/agent-memory.service";
import type { ChannelService } from "../service/channel.service";
import type { ChannelChatTurn } from "../types/channel-chat-turn";

/**
 * RNX-24a: the channel chat's persistence port, one per message, on the room's messages (ChannelService.saveMessage), as
 * the legacy CH loop stored them. The user's raw message is stored once: when the run's reservation holds
 * (`saveUserMessage`, the engine's onReserved hook, RNX-200), or with the decline when the input guardrail rejects it.
 * The answer is stored with the root agent's tokens; a budget-stop answer without tokens; an empty answer is not stored.
 * Memory extraction (RNX-284's path, with the channel id) starts only for a stored answer that is neither the budget
 * stop nor the max-steps text (a blocked answer never reaches it), and is not awaited.
 */
export class ChannelChatPersistence extends ChatEnginePersistence {
  private readonly logger = new Logger(ChannelChatPersistence.name);

  constructor(
    private readonly channels: ChannelService,
    private readonly memory: AgentMemoryService,
    private readonly turn: ChannelChatTurn,
  ) {
    super();
  }

  /** Stores the user's raw message in the room, once. */
  async saveUserMessage(): Promise<void> {
    if (this.turn.isUserMessageSaved) return;
    await this.channels.saveMessage(this.turn.channelAgentId, this.turn.userId, { role: "user", content: this.turn.message });
    this.turn.isUserMessageSaved = true;
  }

  /** Stores the exchange: the user's message unless already stored, then the decline, the budget stop or the (non-empty) answer with its tokens. */
  async saveExchange(record: ChatExchangeRecord): Promise<void> {
    await this.saveUserMessage();
    const isAnswer = record.approvedInput !== null && !this.turn.isBudgetStopped;
    if (isAnswer && !record.approvedOutput) return;
    const saved = await this.channels.saveMessage(this.turn.channelAgentId, this.turn.userId, {
      role: "assistant",
      content: record.approvedOutput,
      ...(isAnswer && { tokens: this.turn.totalTokens }),
    });
    this.turn.assistantMessageId = saved.id;
  }

  /** Starts the memory extraction of the stored answer (RNX-284) with the channel id, without waiting for it; a failure is only logged. */
  handToMemory(record: ChatExchangeRecord): Promise<void> {
    const { agentId, userId, message, scope, channelId, assistantMessageId, isBudgetStopped, isMaxSteps } = this.turn;
    if (!assistantMessageId || isBudgetStopped || isMaxSteps) return Promise.resolve();
    this.memory
      .extractAndStore(agentId, userId, message, record.approvedOutput, scope, channelId)
      .catch((err: unknown) => this.logger.error(`Memory extraction failed: ${errorName(err)}`));
    return Promise.resolve();
  }
}
