import { Injectable } from "@nestjs/common";
import type { DbTransaction } from "../../prisma/db-transaction";
import { PrismaService } from "../../prisma/prisma.service";

/**
 * The queries on `agent_links` (RNX-118): which agents an agent may call. Every method takes the transaction as its
 * optional last argument. The writes take no user: AgentLinkService checks the workspace owner and the workspace
 * first.
 */
@Injectable()
export class AgentLinkRepository {
  constructor(private readonly prisma: PrismaService) {}

  /** The links of this caller agent, oldest first, each with the callee's public fields. */
  listLinks(callerAgentId: string, tx?: DbTransaction) {
    return (tx ?? this.prisma).agentLink.findMany({
      where: { callerAgentId },
      orderBy: { createdAt: "asc" },
      select: {
        callerAgentId: true,
        calleeAgentId: true,
        createdAt: true,
        calleeAgent: { select: { id: true, name: true, description: true, avatar: true, status: true } },
      },
    });
  }

  /** Stores the link (an existing one is kept as it is) and returns it. */
  createLink(callerAgentId: string, calleeAgentId: string, tx?: DbTransaction) {
    return (tx ?? this.prisma).agentLink.upsert({
      where: { callerAgentId_calleeAgentId: { callerAgentId, calleeAgentId } },
      create: { callerAgentId, calleeAgentId },
      update: {},
    });
  }

  /** Removes the link and returns how many rows went (0 or 1). */
  async deleteLink(callerAgentId: string, calleeAgentId: string, tx?: DbTransaction): Promise<number> {
    const { count } = await (tx ?? this.prisma).agentLink.deleteMany({ where: { callerAgentId, calleeAgentId } });
    return count;
  }

  /**
   * The active agents this caller may call in a run: its linked callees in this workspace (the caller's), with what
   * the one-hop call and the run's pre-run estimate read (RX-22b).
   */
  async listCallableAgents(callerAgentId: string, workspaceId: string, tx?: DbTransaction) {
    const links = await (tx ?? this.prisma).agentLink.findMany({
      where: { callerAgentId, calleeAgent: { workspaceId, status: "active" } },
      orderBy: { createdAt: "asc" },
      select: {
        calleeAgent: {
          select: {
            id: true,
            name: true,
            description: true,
            model: true,
            systemPrompt: true,
            temperature: true,
            maxTokens: true,
            workspaceId: true,
          },
        },
      },
    });
    return links.map((link) => link.calleeAgent);
  }
}
