import { Injectable } from "@nestjs/common";
import type { DbTransaction } from "../../prisma/db-transaction";
import { PrismaService } from "../../prisma/prisma.service";

/** The queries on `channel_chat_rooms` (RX-133). Every method takes the transaction as its optional last argument. */
@Injectable()
export class ChannelChatRoomRepository {
  constructor(private readonly prisma: PrismaService) {}

  /** A room of this channel with this name, if there is one. */
  findChatRoomByName(channelId: string, name: string, tx?: DbTransaction) {
    return (tx ?? this.prisma).channelChatRoom.findFirst({
      where: { channelId, name },
    });
  }

  /** Creates a room with this name in this channel. */
  createChatRoom(channelId: string, name: string, tx?: DbTransaction) {
    return (tx ?? this.prisma).channelChatRoom.create({
      data: { channelId, name },
    });
  }
}
