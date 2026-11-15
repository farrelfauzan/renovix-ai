import { Logger } from "@nestjs/common";
import { errorName } from "../../../common/utils/error-name";
import { ChatEnginePersistence } from "../../chat-engine/ports/chat-engine-persistence.port";
import type { ChatExchangeRecord } from "../../chat-engine/types/chat-exchange-record";
import { AgentRunRepository } from "../repository/agent-run.repository";
import { AgentMemoryService } from "../service/agent-memory.service";
import type { AgentRunSessionRow } from "../types/agent-run-session-row";
import type { AgentRunTurn } from "../types/agent-run-turn";

/**
 * RNX-25: the agent run's persistence port, one per agent message, on its session row (AgentRun by session id, the
 * runner's own). The user's raw message is stored once: when the run's reservation holds (`saveUserMessage`, the
 * engine's onReserved hook), so it is kept after a provider error or a disconnect (D341 D2), or with the decline when
 * the input guardrail rejects it (D341 D3). The answer is stored with the root agent's tokens (0 after a budget stop)
 * and the run's cost (D341 D5). Memory extraction runs on RNX-284's path and is not awaited.
 */
export class AgentRunPersistence extends ChatEnginePersistence {
  private readonly logger = new Logger(AgentRunPersistence.name);

  constructor(
    private readonly runs: AgentRunRepository,
    private readonly memory: AgentMemoryService,
    private readonly turn: AgentRunTurn,
  ) {
    super();
  }

  /** Stores the session row (for a new session) and the user's raw message, once. */
  async saveUserMessage(): Promise<void> {
    if (this.turn.run) return;
    const run = await this.findOrCreateRun();
    await this.runs.createMessage({ runId: run.id, role: "user", content: this.turn.message });
    this.turn.run = run;
  }

  /** Stores the exchange: the user's message unless already stored, then the decline, or the answer with the run's tokens and cost. */
  async saveExchange(record: ChatExchangeRecord): Promise<void> {
    await this.saveUserMessage();
    const runId = (this.turn.run as AgentRunSessionRow).id;
    if (record.approvedInput === null) {
      await this.runs.createMessage({ runId, role: "assistant", content: record.approvedOutput });
      return;
    }
    const tokens = this.turn.isBudgetStopped ? 0 : this.turn.totalTokens;
    await this.runs.createMessage({ runId, role: "assistant", content: record.approvedOutput, tokens, cost: this.turn.totalCost });
  }

  /** Starts the memory extraction of the approved answer (RNX-284) without waiting for it; a failure is only logged. */
  handToMemory(record: ChatExchangeRecord): Promise<void> {
    const { agentId, userId, message, scope } = this.turn;
    this.memory
      .extractAndStore(agentId, userId, message, record.approvedOutput, scope)
      .catch((err: unknown) => this.logger.error(`Memory extraction failed: ${errorName(err)}`));
    return Promise.resolve();
  }

  /** RNX-119: the runner's active run of this session, or a new run that belongs to the runner. */
  private async findOrCreateRun(): Promise<AgentRunSessionRow> {
    const { agentId, userId, sessionId } = this.turn;
    const existing = await this.runs.findActiveRun(agentId, userId, sessionId);
    return existing ?? this.runs.createRun({ agentId, userId, sessionId });
  }
}
