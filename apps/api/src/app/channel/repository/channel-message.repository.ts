import { Injectable } from "@nestjs/common";
import type { Prisma } from "@generated/prisma/client.js";
import type { DbTransaction } from "../../prisma/db-transaction";
import { PrismaService } from "../../prisma/prisma.service";

/**
 * The queries on `channel_messages` (RX-136). Every method takes the transaction as its optional last
 * argument. A message belongs to a room and an agent; the service checks the channel's owner first.
 */
@Injectable()
export class ChannelMessageRepository {
  constructor(private readonly prisma: PrismaService) {}

  /** This agent's messages in this room, oldest first, `take` of them after skipping `skip`. */
  listRoomAgentMessages(
    chatRoomId: string,
    agentId: string,
    take: number,
    skip: number,
    tx?: DbTransaction,
  ) {
    return (tx ?? this.prisma).channelMessage.findMany({
      where: { chatRoomId, agentId },
      orderBy: { createdAt: "asc" },
      take,
      skip,
    });
  }

  /** Stores a message. */
  createChannelMessage(
    data: Prisma.ChannelMessageUncheckedCreateInput,
    tx?: DbTransaction,
  ) {
    return (tx ?? this.prisma).channelMessage.create({ data });
  }

  /** Sets the content and metadata of the assistant message with this id, if it is this agent's in this room. */
  updateAssistantMessage(
    messageId: string,
    chatRoomId: string,
    agentId: string,
    data: Pick<Prisma.ChannelMessageUncheckedUpdateManyInput, "content" | "metadata">,
    tx?: DbTransaction,
  ) {
    return (tx ?? this.prisma).channelMessage.updateMany({
      where: {
        id: messageId,
        role: "assistant",
        agentId,
        chatRoomId,
      },
      data,
    });
  }

  /** Deletes this agent's messages in this room. */
  deleteRoomAgentMessages(
    chatRoomId: string,
    agentId: string,
    tx?: DbTransaction,
  ) {
    return (tx ?? this.prisma).channelMessage.deleteMany({
      where: { chatRoomId, agentId },
    });
  }

  /** Deletes this agent's messages in every room of this channel. */
  deleteChannelAgentMessages(
    channelId: string,
    agentId: string,
    tx?: DbTransaction,
  ) {
    return (tx ?? this.prisma).channelMessage.deleteMany({
      where: {
        agentId,
        chatRoom: { channelId },
      },
    });
  }
}
