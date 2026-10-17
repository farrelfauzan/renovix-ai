import { Injectable } from "@nestjs/common";
import type { DbTransaction } from "../../prisma/db-transaction";
import { PrismaService } from "../../prisma/prisma.service";

/**
 * The queries on `conversations` (RX-136). Every method takes the transaction as its optional last argument.
 * The writes by id (`updateConversationTitle`, `deleteConversation`) take no user: the run that titles a
 * conversation created it for its user, and the service checks the owner with `findUserConversation`
 * before a delete.
 */
@Injectable()
export class ConversationRepository {
  constructor(private readonly prisma: PrismaService) {}

  /** The conversation with this id if it belongs to this user. */
  findUserConversation(
    conversationId: string,
    userId: string,
    tx?: DbTransaction,
  ) {
    return (tx ?? this.prisma).conversation.findFirst({
      where: { id: conversationId, userId },
    });
  }

  /** This user's conversation with its messages, oldest first. */
  findUserConversationWithMessages(
    conversationId: string,
    userId: string,
    tx?: DbTransaction,
  ) {
    return (tx ?? this.prisma).conversation.findFirst({
      where: { id: conversationId, userId },
      include: {
        messages: {
          orderBy: { createdAt: "asc" },
          select: {
            id: true,
            role: true,
            content: true,
            documentFormat: true,
            documentFilename: true,
            documentKey: true,
            createdAt: true,
          },
        },
      },
    });
  }

  /** This user's conversations, most recently updated first, `take` of them after skipping `skip`. */
  listUserConversations(
    userId: string,
    skip: number,
    take: number,
    tx?: DbTransaction,
  ) {
    return (tx ?? this.prisma).conversation.findMany({
      where: { userId },
      orderBy: { updatedAt: "desc" },
      skip,
      take,
      select: {
        id: true,
        title: true,
        model: true,
        createdAt: true,
        updatedAt: true,
      },
    });
  }

  /** How many conversations this user has. */
  countUserConversations(userId: string, tx?: DbTransaction) {
    return (tx ?? this.prisma).conversation.count({ where: { userId } });
  }

  /** Creates a conversation of this user with this model. */
  createConversation(userId: string, model: string, tx?: DbTransaction) {
    return (tx ?? this.prisma).conversation.create({
      data: { userId, model },
    });
  }

  /** Sets the title of the conversation with this id. */
  updateConversationTitle(
    conversationId: string,
    title: string,
    tx?: DbTransaction,
  ) {
    return (tx ?? this.prisma).conversation.update({
      where: { id: conversationId },
      data: { title },
    });
  }

  /** Deletes the conversation with this id (its messages cascade). */
  deleteConversation(conversationId: string, tx?: DbTransaction) {
    return (tx ?? this.prisma).conversation.delete({
      where: { id: conversationId },
    });
  }

  /** This user's `take` most recently updated conversations, each with how many user messages it has. */
  listRecentConversationsWithUserMessageCount(
    userId: string,
    take: number,
    tx?: DbTransaction,
  ) {
    return (tx ?? this.prisma).conversation.findMany({
      where: { userId },
      orderBy: { updatedAt: "desc" },
      take,
      select: {
        id: true,
        _count: { select: { messages: { where: { role: "user" } } } },
      },
    });
  }
}
