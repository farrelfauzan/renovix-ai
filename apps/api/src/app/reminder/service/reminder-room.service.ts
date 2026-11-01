import { Injectable } from "@nestjs/common";
import type { Prisma } from "@generated/prisma/client.js";
import { ChannelChatRoomRepository } from "../../channel/repository/channel-chat-room.repository";
import { ChannelMessageRepository } from "../../channel/repository/channel-message.repository";

const HISTORY_LIMIT = 10;

/** What a scheduled reminder run reads from and writes to the room it posts in (RNX-139). */
@Injectable()
export class ReminderRoomService {
  constructor(
    private readonly chatRooms: ChannelChatRoomRepository,
    private readonly messages: ChannelMessageRepository,
  ) {}

  /** The room with this id. */
  findChatRoom(chatRoomId: string) {
    return this.chatRooms.findChatRoom(chatRoomId);
  }

  /** This agent's last messages in the room, newest first. */
  listRecentMessages(chatRoomId: string, agentId: string) {
    return this.messages.listRecentRoomAgentMessages(chatRoomId, agentId, HISTORY_LIMIT);
  }

  /** Stores a message in the room. */
  saveMessage(data: Prisma.ChannelMessageUncheckedCreateInput) {
    return this.messages.createChannelMessage(data);
  }
}
