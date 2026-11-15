import { Injectable } from "@nestjs/common";
import type { DbTransaction } from "../../prisma/db-transaction";
import { PrismaService } from "../../prisma/prisma.service";
import { LIVE_AGENT } from "../config/live-agent";
import type { AgentMessageInput } from "../types/agent-message-input";
import type { AgentRunSessionInput } from "../types/agent-run-session-input";
import type { ChildRunInput } from "../types/child-run-input";

/** The earlier messages a new agent message gets as history (RNX-200: 19, read before the current message is saved). */
const HISTORY_MESSAGES = 19;
/** The runs `listRuns` returns, most recently updated first. */
const LISTED_RUNS = 50;

/**
 * The queries on `agent_runs` and their `agent_messages`: the hops (child runs, RNX-302) and, RNX-25, the session rows
 * and messages of AgentRunService and its engine adapters. Every method takes the transaction as its optional last
 * argument.
 */
@Injectable()
export class AgentRunRepository {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Stores a hop under the runner's parent run, with the task as its user message and the answer as its assistant
   * message. The hop belongs to the parent's session and channel (copied from the parent, a run of this runner; another
   * person's or an unknown parent run throws). It ends now and started `durationMs` before: the run and the task are
   * dated at its start, the answer at its end, so the two messages keep their order when read by date. Returns the hop.
   */
  async createChildRun(input: ChildRunInput, tx?: DbTransaction) {
    const db = tx ?? this.prisma;
    const parent = await db.agentRun.findFirstOrThrow({
      where: { id: input.parentRunId, userId: input.userId },
      select: { sessionId: true, channelType: true },
    });
    const endedAt = new Date();
    const startedAt = new Date(endedAt.getTime() - input.durationMs);
    return db.agentRun.create({
      data: {
        agentId: input.agentId,
        userId: input.userId,
        sessionId: parent.sessionId,
        channelType: parent.channelType,
        status: input.status,
        parentRunId: input.parentRunId,
        depth: input.depth,
        parentCallId: input.parentCallId,
        durationMs: input.durationMs,
        createdAt: startedAt,
        messages: {
          create: [
            { role: "user", content: input.task, createdAt: startedAt },
            { role: "assistant", content: input.answer, createdAt: endedAt },
          ],
        },
      },
    });
  }

  /** RNX-119: the active top-level run of this session that belongs to this runner (never another person's). RNX-302: never a hop. */
  findActiveRun(agentId: string, userId: string, sessionId: string, tx?: DbTransaction) {
    return (tx ?? this.prisma).agentRun.findFirst({
      where: { agentId, userId, sessionId, status: "active", parentRunId: null },
    });
  }

  /** A new active web run (session row) that belongs to the runner. */
  createRun(input: AgentRunSessionInput, tx?: DbTransaction) {
    return (tx ?? this.prisma).agentRun.create({
      data: { ...input, channelType: "web", status: "active" },
    });
  }

  /** The run's earliest user and assistant messages, oldest first (the history of its next message; RNX-220 owns the order). */
  listHistory(runId: string, tx?: DbTransaction) {
    return (tx ?? this.prisma).agentMessage.findMany({
      where: { runId, role: { in: ["user", "assistant"] } },
      orderBy: { createdAt: "asc" },
      take: HISTORY_MESSAGES,
      select: { role: true, content: true },
    });
  }

  /** Stores one message of a run. */
  createMessage(input: AgentMessageInput, tx?: DbTransaction) {
    return (tx ?? this.prisma).agentMessage.create({ data: input });
  }

  /** The runner's own top-level runs of a live agent, each with its last message and its message count. RNX-302: never a hop. */
  listRuns(agentId: string, userId: string, tx?: DbTransaction) {
    return (tx ?? this.prisma).agentRun.findMany({
      where: { agentId, userId, parentRunId: null, agent: LIVE_AGENT },
      orderBy: { updatedAt: "desc" },
      take: LISTED_RUNS,
      include: {
        messages: {
          take: 1,
          orderBy: { createdAt: "desc" },
          select: { content: true, role: true },
        },
        _count: { select: { messages: true } },
      },
    });
  }

  /** A run of a live agent with its messages, oldest first. */
  findRunWithMessages(runId: string, agentId: string, tx?: DbTransaction) {
    return (tx ?? this.prisma).agentRun.findFirst({
      where: { id: runId, agentId, agent: LIVE_AGENT },
      include: { messages: { orderBy: { createdAt: "asc" } } },
    });
  }

  /** A run of a live agent. */
  findRun(runId: string, agentId: string, tx?: DbTransaction) {
    return (tx ?? this.prisma).agentRun.findFirst({
      where: { id: runId, agentId, agent: LIVE_AGENT },
    });
  }

  /** Deletes a run; RNX-302: its hops go with it (ON DELETE CASCADE). */
  deleteRun(runId: string, tx?: DbTransaction) {
    return (tx ?? this.prisma).agentRun.delete({ where: { id: runId } });
  }
}
