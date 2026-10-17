import { Injectable } from "@nestjs/common";
import type { Prisma } from "@generated/prisma/client.js";
import type { DbTransaction } from "../../prisma/db-transaction";
import { PrismaService } from "../../prisma/prisma.service";

/** The least confidence a memory needs to be given to a model. */
const RELEVANT_MIN_CONFIDENCE = 0.55;

/** The confidence a memory gets when the user's later conversation confirms it. */
const CONFIRMED_CONFIDENCE = 0.9;

/**
 * The queries on `user_memories` (RX-141). Every method takes the transaction as its optional last argument.
 * `updateMemory` writes by id and takes no user: the service checks the owner first (`findVisibleMemory`),
 * as before; `confirmMemory` and `markAllMemoriesDeleted` keep the user in their condition.
 */
@Injectable()
export class UserMemoryRepository {
  constructor(private readonly prisma: PrismaService) {}

  /** This user's active memories, pinned first, then the most recently confirmed. */
  listActiveMemories(userId: string, tx?: DbTransaction) {
    return (tx ?? this.prisma).userMemory.findMany({
      where: { userId, status: "active" },
      orderBy: [{ isUserPinned: "desc" }, { lastConfirmedAt: "desc" }],
    });
  }

  /** This user's memories that are not deleted (archived ones stay), pinned first, then the most recently confirmed. */
  listVisibleMemories(userId: string, tx?: DbTransaction) {
    return (tx ?? this.prisma).userMemory.findMany({
      where: { userId, status: { not: "deleted" } },
      orderBy: [{ isUserPinned: "desc" }, { lastConfirmedAt: "desc" }],
    });
  }

  /** The memory with this id if it belongs to this user and is not deleted. */
  findVisibleMemory(id: string, userId: string, tx?: DbTransaction) {
    return (tx ?? this.prisma).userMemory.findFirst({
      where: { id, userId, status: { not: "deleted" } },
    });
  }

  /** Stores a memory of this user. */
  createMemory(
    userId: string,
    data: Omit<Prisma.UserMemoryUncheckedCreateInput, "userId">,
    tx?: DbTransaction,
  ) {
    return (tx ?? this.prisma).userMemory.create({
      data: { userId, ...data },
    });
  }

  /** Changes the memory with this id. */
  updateMemory(
    id: string,
    data: Prisma.UserMemoryUncheckedUpdateInput,
    tx?: DbTransaction,
  ) {
    return (tx ?? this.prisma).userMemory.update({
      where: { id },
      data,
    });
  }

  /** Marks every memory of this user that is not deleted as deleted; returns how many. */
  async markAllMemoriesDeleted(userId: string, tx?: DbTransaction) {
    const result = await (tx ?? this.prisma).userMemory.updateMany({
      where: { userId, status: { not: "deleted" } },
      data: { status: "deleted" },
    });
    return result.count;
  }

  /**
   * The memories to give a model: this user's active ones with enough confidence that have not expired,
   * pinned first, then the most confident, then the most recently confirmed; at most `take`.
   */
  findRelevantMemories(userId: string, take: number, tx?: DbTransaction) {
    return (tx ?? this.prisma).userMemory.findMany({
      where: {
        userId,
        status: "active",
        confidence: { gte: RELEVANT_MIN_CONFIDENCE },
        OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
      },
      orderBy: [
        { isUserPinned: "desc" },
        { confidence: "desc" },
        { lastConfirmedAt: "desc" },
      ],
      take,
    });
  }

  /** Confirms the memory with this id if it belongs to this user: confidence 0.9 and confirmed now. */
  confirmMemory(userId: string, id: string, tx?: DbTransaction) {
    return (tx ?? this.prisma).userMemory.updateMany({
      where: { id, userId },
      data: { lastConfirmedAt: new Date(), confidence: CONFIRMED_CONFIDENCE },
    });
  }

  /** This user's active memories of this type. */
  listActiveMemoriesOfType(userId: string, type: string, tx?: DbTransaction) {
    return (tx ?? this.prisma).userMemory.findMany({
      where: { userId, type, status: "active" },
    });
  }

  /** This user's active memories, the most confident first, `take` of them (what an agent is given). */
  listTopActiveMemories(userId: string, take: number, tx?: DbTransaction) {
    return (tx ?? this.prisma).userMemory.findMany({
      where: { userId, status: "active" },
      orderBy: { confidence: "desc" },
      take,
    });
  }

  /** This user's active memory whose text contains this snippet, if there is one. */
  findActiveMemoryContaining(userId: string, snippet: string, tx?: DbTransaction) {
    return (tx ?? this.prisma).userMemory.findFirst({
      where: { userId, content: { contains: snippet }, status: "active" },
    });
  }
}
