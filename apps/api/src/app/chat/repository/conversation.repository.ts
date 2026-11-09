import { Injectable, NotFoundException } from "@nestjs/common";
import { Prisma } from "@generated/prisma/client.js";
import type { DbTransaction } from "../../prisma/db-transaction";
import { PrismaService } from "../../prisma/prisma.service";

/**
 * The queries on `conversations` (RX-136). Every method takes the transaction as its optional last argument.
 * The writes by id (`updateConversationTitle`, `softDeleteConversation`) take no user: the run that titles a
 * conversation created it for its user, and the service checks the owner with `findUserConversation`
 * before a delete. RNX-145: PrismaService hides deleted conversations from top-level reads (VISIBLE_ONLY); the writes
 * by id name `deletedAt: null` themselves.
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

  /** Sets the title of the live conversation with this id; 404 when it is deleted (RNX-145). */
  updateConversationTitle(
    conversationId: string,
    title: string,
    tx?: DbTransaction,
  ) {
    return this.refuseDeleted(() =>
      (tx ?? this.prisma).conversation.update({
        where: { id: conversationId, deletedAt: null },
        data: { title },
      }),
    );
  }

  /**
   * Soft-deletes the live conversation with this id, by this user (RNX-145): the row and its messages stay. Returns
   * the conversation; 404 when it is already deleted.
   */
  softDeleteConversation(conversationId: string, deletedById: string, tx?: DbTransaction) {
    return this.refuseDeleted(() =>
      (tx ?? this.prisma).conversation.update({
        where: { id: conversationId, deletedAt: null },
        data: { deletedAt: new Date(), deletedById },
      }),
    );
  }

  /** RNX-126: this user's deleted conversations, newest-deleted first, `take` at most. */
  listDeletedUserConversations(userId: string, take: number, tx?: DbTransaction) {
    return (tx ?? this.prisma).conversation.findMany({
      where: { userId, deletedAt: { not: null } },
      select: { id: true, title: true, deletedAt: true },
      orderBy: { deletedAt: "desc" },
      take,
    });
  }

  /** RNX-126: restores this user's deleted conversation with this id; one conditional write, 404 when there is none. */
  restoreUserConversation(conversationId: string, userId: string, tx?: DbTransaction) {
    return this.refuseDeleted(() =>
      (tx ?? this.prisma).conversation.update({
        where: { id: conversationId, userId, deletedAt: { not: null } },
        data: { deletedAt: null, deletedById: null },
        select: { id: true, title: true },
      }),
    );
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

  /** Runs a write on one live conversation; Prisma's "no such row" (P2025: deleted, or deleted meanwhile) becomes a 404. */
  private async refuseDeleted<T>(write: () => Promise<T>): Promise<T> {
    try {
      return await write();
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2025") {
        throw new NotFoundException("Conversation not found");
      }
      throw err;
    }
  }
}
