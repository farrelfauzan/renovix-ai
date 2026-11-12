import { Injectable } from "@nestjs/common";
import type { DbTransaction } from "../../prisma/db-transaction";
import { PrismaService } from "../../prisma/prisma.service";
import type { ChildRunInput } from "../types/child-run-input";

/**
 * The queries on `agent_runs` and their `agent_messages`. RNX-302: today only the hops (child runs); the run, message
 * and metering calls of AgentRunService still use PrismaService directly (RX-23, RX-25). Every method takes the
 * transaction as its optional last argument.
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
}
