import { Injectable } from "@nestjs/common";
import type { Prisma } from "@generated/prisma/client.js";
import type { DbTransaction } from "../../prisma/db-transaction";
import { PrismaService } from "../../prisma/prisma.service";

/** The queries on `knowledge_bases` (RX-137, RX-133). Every method takes the transaction as its optional last argument. */
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

  /** Updates the knowledge base with this id. */
  updateKnowledgeBase(
    id: string,
    data: Prisma.KnowledgeBaseUpdateInput,
    tx?: DbTransaction,
  ) {
    return (tx ?? this.prisma).knowledgeBase.update({
      where: { id },
      data,
    });
  }

  /** Deletes the knowledge base with this id (its chunks go with it: ON DELETE CASCADE). */
  deleteKnowledgeBase(id: string, tx?: DbTransaction) {
    return (tx ?? this.prisma).knowledgeBase.delete({ where: { id } });
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
}
