import { Injectable } from "@nestjs/common";
import type { DbTransaction } from "../../prisma/db-transaction";
import { PrismaService } from "../../prisma/prisma.service";

/**
 * The queries on `channel_agents`, the links between a channel and its agents (RX-136). Every method takes
 * the transaction as its optional last argument. They take no user: the service checks the channel's
 * owner first.
 */
@Injectable()
export class ChannelAgentRepository {
  constructor(private readonly prisma: PrismaService) {}

  /** Links this agent to this channel with this role and returns the link with the agent's public fields. */
  createChannelAgent(
    channelId: string,
    agentId: string,
    role: string,
    tx?: DbTransaction,
  ) {
    return (tx ?? this.prisma).channelAgent.create({
      data: { channelId, agentId, role },
      include: {
        agent: {
          select: {
            id: true,
            name: true,
            avatar: true,
            avatarColor: true,
            status: true,
          },
        },
      },
    });
  }

  /** The link of this agent to this channel, if there is one. */
  findChannelAgent(channelId: string, agentId: string, tx?: DbTransaction) {
    return (tx ?? this.prisma).channelAgent.findFirst({
      where: { channelId, agentId },
    });
  }

  /**
   * The link of this agent to this channel with the channel and its workspace, and the agent with its
   * enabled tools, its knowledge bases and its connected integrations.
   */
  findChannelAgentWithAgent(
    channelId: string,
    agentId: string,
    tx?: DbTransaction,
  ) {
    return (tx ?? this.prisma).channelAgent.findFirst({
      where: { channelId, agentId },
      include: {
        channel: { include: { workspace: true } },
        agent: {
          include: {
            tools: { where: { enabled: true } },
            knowledgeBases: true,
            integrations: { where: { status: "connected" } },
          },
        },
      },
    });
  }

  /** The channel and agent ids of the link with this id. */
  findChannelAgentIds(channelAgentId: string, tx?: DbTransaction) {
    return (tx ?? this.prisma).channelAgent.findUnique({
      where: { id: channelAgentId },
      select: { channelId: true, agentId: true },
    });
  }

  /** Deletes the link with this id. */
  deleteChannelAgent(channelAgentId: string, tx?: DbTransaction) {
    return (tx ?? this.prisma).channelAgent.delete({
      where: { id: channelAgentId },
    });
  }
}
