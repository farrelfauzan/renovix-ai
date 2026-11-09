import { Injectable } from "@nestjs/common";
import type { DbTransaction } from "../../prisma/db-transaction";
import { PrismaService } from "../../prisma/prisma.service";
import { LIVE_KNOWLEDGE_BASE } from "../../knowledge/config/live-knowledge-base";

/** The queries on `agent_knowledge_bases` (RX-133). Every method takes the transaction as its optional last argument. */
@Injectable()
export class AgentKnowledgeBaseRepository {
  constructor(private readonly prisma: PrismaService) {}

  /** The link of this live (RNX-145) knowledge base to this agent, if there is one. */
  findAgentKnowledgeBase(
    agentId: string,
    knowledgeBaseId: string,
    tx?: DbTransaction,
  ) {
    return (tx ?? this.prisma).agentKnowledgeBase.findFirst({
      where: { agentId, knowledgeBaseId, knowledgeBase: LIVE_KNOWLEDGE_BASE },
    });
  }

  /** Links this knowledge base to this agent. */
  createAgentKnowledgeBase(
    agentId: string,
    knowledgeBaseId: string,
    tx?: DbTransaction,
  ) {
    return (tx ?? this.prisma).agentKnowledgeBase.create({
      data: { agentId, knowledgeBaseId },
    });
  }

  /** Deletes the link with this id. */
  deleteAgentKnowledgeBase(id: string, tx?: DbTransaction) {
    return (tx ?? this.prisma).agentKnowledgeBase.delete({ where: { id } });
  }
}
