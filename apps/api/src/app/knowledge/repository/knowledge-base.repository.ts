import { Injectable, NotFoundException } from "@nestjs/common";
import type { Prisma } from "@generated/prisma/client.js";
// The runtime's class, not the generated client's re-export: `bun run seed` (prisma/seed-system-knowledge.ts) loads
// this file without the `@generated` path alias, so only type imports may name it.
import { PrismaClientKnownRequestError } from "@prisma/client/runtime/client";
import type { DbTransaction } from "../../prisma/db-transaction";
import { PrismaService } from "../../prisma/prisma.service";

/**
 * The queries on `knowledge_bases` (RX-137, RX-133). Every method takes the transaction as its optional last argument.
 * RNX-145: PrismaService hides deleted knowledge bases from top-level reads (VISIBLE_ONLY); the writes by id name
 * `deletedAt: null` themselves.
 */
@Injectable()
export class KnowledgeBaseRepository {
  constructor(private readonly prisma: PrismaService) {}

  /** Creates a personal knowledge base of this user. */
  createPersonalKnowledgeBase(
    userId: string,
    name: string,
    description: string | null,
    tx?: DbTransaction,
  ) {
    return (tx ?? this.prisma).knowledgeBase.create({
      data: {
        userId,
        name,
        description,
      },
    });
  }

  /** This user's personal knowledge bases (no workspace base), newest first, each with its number of chunks. */
  listPersonalKnowledgeBases(userId: string, tx?: DbTransaction) {
    return (tx ?? this.prisma).knowledgeBase.findMany({
      where: { userId, workspaceId: null },
      orderBy: { createdAt: "desc" },
      include: { _count: { select: { chunks: true } } },
    });
  }

  /**
   * The knowledge base with this id, with its number of chunks, whoever owns it: the service tells "not
   * found" from "not yours" (404 or 403) from the row.
   */
  findKnowledgeBaseWithChunkCount(id: string, tx?: DbTransaction) {
    return (tx ?? this.prisma).knowledgeBase.findUnique({
      where: { id },
      include: { _count: { select: { chunks: true } } },
    });
  }

  /** The knowledge base with this id, whoever owns it; the caller checks the owner (RX-133). */
  findKnowledgeBaseById(id: string, tx?: DbTransaction) {
    return (tx ?? this.prisma).knowledgeBase.findUnique({
      where: { id },
    });
  }

  /** Updates the live knowledge base with this id; 404 when it is deleted (RNX-145). */
  updateKnowledgeBase(
    id: string,
    data: Prisma.KnowledgeBaseUpdateInput,
    tx?: DbTransaction,
  ) {
    return this.refuseDeleted(() =>
      (tx ?? this.prisma).knowledgeBase.update({
        where: { id, deletedAt: null },
        data,
      }),
    );
  }

  /**
   * Soft-deletes the live knowledge base with this id, by this user (RNX-145): the row, its chunks and its agent links
   * stay. Returns the knowledge base; 404 when it is already deleted.
   */
  softDeleteKnowledgeBase(id: string, deletedById: string, tx?: DbTransaction) {
    return this.refuseDeleted(() =>
      (tx ?? this.prisma).knowledgeBase.update({
        where: { id, deletedAt: null },
        data: { deletedAt: new Date(), deletedById },
      }),
    );
  }

  /** RNX-126: this user's deleted personal knowledge bases (no workspace base), newest-deleted first, `take` at most. */
  listDeletedPersonalKnowledgeBases(userId: string, take: number, tx?: DbTransaction) {
    return (tx ?? this.prisma).knowledgeBase.findMany({
      where: { userId, workspaceId: null, deletedAt: { not: null } },
      select: { id: true, name: true, deletedAt: true },
      orderBy: { deletedAt: "desc" },
      take,
    });
  }

  /** RNX-126: restores this user's deleted personal knowledge base with this id; one conditional write, 404 when there is none. */
  restorePersonalKnowledgeBase(id: string, userId: string, tx?: DbTransaction) {
    return this.refuseDeleted(() =>
      (tx ?? this.prisma).knowledgeBase.update({
        where: { id, userId, workspaceId: null, deletedAt: { not: null } },
        data: { deletedAt: null, deletedById: null },
        select: { id: true, name: true },
      }),
    );
  }

  /** RNX-126: the deleted knowledge bases of this workspace, newest-deleted first, `take` at most. */
  listDeletedWorkspaceKnowledgeBases(workspaceId: string, take: number, tx?: DbTransaction) {
    return (tx ?? this.prisma).knowledgeBase.findMany({
      where: { workspaceId, deletedAt: { not: null } },
      select: { id: true, name: true, deletedAt: true },
      orderBy: { deletedAt: "desc" },
      take,
    });
  }

  /** RNX-126: restores the deleted knowledge base with this id of this workspace; one conditional write, 404 when there is none. */
  restoreWorkspaceKnowledgeBase(id: string, workspaceId: string, tx?: DbTransaction) {
    return this.refuseDeleted(() =>
      (tx ?? this.prisma).knowledgeBase.update({
        where: { id, workspaceId, deletedAt: { not: null } },
        data: { deletedAt: null, deletedById: null },
        select: { id: true, name: true },
      }),
    );
  }

  /** The system knowledge base, active or not, if there is one. */
  findSystemKnowledgeBase(tx?: DbTransaction) {
    return (tx ?? this.prisma).knowledgeBase.findFirst({
      where: { isSystem: true },
    });
  }

  /** The system knowledge base if it is active. */
  findActiveSystemKnowledgeBase(tx?: DbTransaction) {
    return (tx ?? this.prisma).knowledgeBase.findFirst({
      where: { isSystem: true, active: true },
    });
  }

  /** Creates the system knowledge base, active. */
  createSystemKnowledgeBase(
    name: string,
    description: string,
    tx?: DbTransaction,
  ) {
    return (tx ?? this.prisma).knowledgeBase.create({
      data: {
        name,
        description,
        isSystem: true,
        active: true,
      },
    });
  }

  /** Runs a write on one live knowledge base; Prisma's "no such row" (P2025: deleted, or deleted meanwhile) becomes a 404. */
  private async refuseDeleted<T>(write: () => Promise<T>): Promise<T> {
    try {
      return await write();
    } catch (err) {
      if (err instanceof PrismaClientKnownRequestError && err.code === "P2025") {
        throw new NotFoundException("Knowledge base not found");
      }
      throw err;
    }
  }
}
