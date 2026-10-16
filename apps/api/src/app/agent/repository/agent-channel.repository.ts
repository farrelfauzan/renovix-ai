import { Injectable } from "@nestjs/common";
import type { Prisma } from "@generated/prisma/client.js";
import type { DbTransaction } from "../../prisma/db-transaction";
import { PrismaService } from "../../prisma/prisma.service";

/** The queries on `agent_channels` (RX-133). Every method takes the transaction as its optional last argument. */
@Injectable()
export class AgentChannelRepository {
  constructor(private readonly prisma: PrismaService) {}

  /** This agent's channel with this id, if there is one. */
  findAgentChannel(channelId: string, agentId: string, tx?: DbTransaction) {
    return (tx ?? this.prisma).agentChannel.findFirst({
      where: { id: channelId, agentId },
    });
  }

  /** Adds a channel to this agent. */
  createAgentChannel(
    agentId: string,
    data: Omit<Prisma.AgentChannelUncheckedCreateInput, "agentId">,
    tx?: DbTransaction,
  ) {
    return (tx ?? this.prisma).agentChannel.create({
      data: { agentId, ...data },
    });
  }

  /** Replaces the config of the channel with this id. */
  updateAgentChannelConfig(
    channelId: string,
    config: Prisma.AgentChannelUncheckedUpdateInput["config"],
    tx?: DbTransaction,
  ) {
    return (tx ?? this.prisma).agentChannel.update({
      where: { id: channelId },
      data: { config },
    });
  }

  /** Deletes the channel with this id. */
  deleteAgentChannel(channelId: string, tx?: DbTransaction) {
    return (tx ?? this.prisma).agentChannel.delete({
      where: { id: channelId },
    });
  }
}
