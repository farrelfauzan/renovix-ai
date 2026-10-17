import { Injectable } from "@nestjs/common";
import type { Prisma } from "@generated/prisma/client.js";
import type { DbTransaction } from "../../prisma/db-transaction";
import { PrismaService } from "../../prisma/prisma.service";

/** The queries on `agent_tools` (RX-133). Every method takes the transaction as its optional last argument. */
@Injectable()
export class AgentToolRepository {
  constructor(private readonly prisma: PrismaService) {}

  /** This agent's tool with this id, if there is one. */
  findAgentTool(toolId: string, agentId: string, tx?: DbTransaction) {
    return (tx ?? this.prisma).agentTool.findFirst({
      where: { id: toolId, agentId },
    });
  }

  /** Adds a tool to this agent. */
  createAgentTool(
    agentId: string,
    data: Omit<Prisma.AgentToolUncheckedCreateInput, "agentId">,
    tx?: DbTransaction,
  ) {
    return (tx ?? this.prisma).agentTool.create({
      data: { agentId, ...data },
    });
  }

  /** Adds these tools to this agent in one statement. */
  createAgentTools(
    agentId: string,
    tools: Omit<Prisma.AgentToolCreateManyInput, "agentId">[],
    tx?: DbTransaction,
  ) {
    return (tx ?? this.prisma).agentTool.createMany({
      data: tools.map((tool) => ({ agentId, ...tool })),
    });
  }

  /** Deletes the tool with this id. */
  deleteAgentTool(toolId: string, tx?: DbTransaction) {
    return (tx ?? this.prisma).agentTool.delete({ where: { id: toolId } });
  }
}
