import { Injectable } from "@nestjs/common";
import type { DbTransaction } from "../../prisma/db-transaction";
import { PrismaService } from "../../prisma/prisma.service";
import type { ChunkSearchRow } from "../types/chunk-search-row";
import type { NewKnowledgeChunk } from "../types/new-knowledge-chunk";
import type { SystemChunkSearchRow } from "../types/system-chunk-search-row";

/**
 * The queries on `knowledge_chunks` (RX-137), with the raw SQL of chunk storage and vector search: the
 * embedding column is `vector(1024)`, which Prisma cannot read or write. Every value goes in as a query
 * parameter. Every method but `insertChunks` takes the transaction as its optional last argument.
 */
@Injectable()
export class KnowledgeChunkRepository {
  constructor(private readonly prisma: PrismaService) {}

  /** One page of this base's chunks, newest first, without their embeddings. */
  listChunks(knowledgeBaseId: string, limit: number, offset: number, tx?: DbTransaction) {
    return (tx ?? this.prisma).knowledgeChunk.findMany({
      where: { knowledgeBaseId },
      select: {
        id: true,
        content: true,
        metadata: true,
        tokenCount: true,
        createdAt: true,
      },
      orderBy: { createdAt: "desc" },
      take: limit,
      skip: offset,
    });
  }

  /** The number of chunks in this base. */
  countChunks(knowledgeBaseId: string, tx?: DbTransaction) {
    return (tx ?? this.prisma).knowledgeChunk.count({ where: { knowledgeBaseId } });
  }

  /** The chunk with this id, in whatever base: the service checks the base. */
  findChunkById(id: string, tx?: DbTransaction) {
    return (tx ?? this.prisma).knowledgeChunk.findUnique({
      where: { id },
    });
  }

  /** Deletes the chunk with this id. */
  deleteChunk(id: string, tx?: DbTransaction) {
    return (tx ?? this.prisma).knowledgeChunk.delete({ where: { id } });
  }

  /** The metadata of every chunk in this base. */
  listChunkMetadata(knowledgeBaseId: string, tx?: DbTransaction) {
    return (tx ?? this.prisma).knowledgeChunk.findMany({
      where: { knowledgeBaseId },
      select: { metadata: true },
    });
  }

  /**
   * Stores these chunks in this base, all or none, and returns one count per chunk. One INSERT per chunk in
   * one batch transaction (Prisma's array form), as before RX-137: it opens its own transaction and cannot
   * join an open one, so it takes no `tx`.
   */
  insertChunks(knowledgeBaseId: string, chunks: readonly NewKnowledgeChunk[]) {
    return this.prisma.$transaction(
      chunks.map((chunk) => {
        const vector = `[${chunk.embedding.join(",")}]`;
        return this.prisma.$executeRaw`
            INSERT INTO "knowledge_chunks" (id, "knowledgeBaseId", content, metadata, embedding, "tokenCount", "createdAt")
            VALUES (
              gen_random_uuid(),
              ${knowledgeBaseId},
              ${chunk.content},
              ${JSON.stringify(chunk.metadata)}::jsonb,
              ${vector}::vector,
              ${chunk.tokenCount},
              now()
            )
          `;
      }),
    );
  }

  /** Deletes the chunks of this base that came from the file with this S3 key (metadata.s3Key). */
  deleteChunksOfFile(knowledgeBaseId: string, s3Key: string, tx?: DbTransaction) {
    return (tx ?? this.prisma).$executeRaw`
        DELETE FROM "knowledge_chunks"
        WHERE "knowledgeBaseId" = ${knowledgeBaseId}
          AND metadata->>'s3Key' = ${s3Key}
      `;
  }

  /** The `topK` chunks of this base closest to `embedding` (cosine distance), closest first; chunks without an embedding are left out. */
  searchChunksInKnowledgeBase(
    knowledgeBaseId: string,
    embedding: readonly number[],
    topK: number,
    tx?: DbTransaction,
  ) {
    const vector = `[${embedding.join(",")}]`;
    return (tx ?? this.prisma).$queryRaw<ChunkSearchRow[]>`
          SELECT
            kc.id,
            kc.content,
            kc.metadata,
            kc."tokenCount" AS token_count,
            kc."knowledgeBaseId" AS knowledge_base_id,
            1 - (kc.embedding <=> ${vector}::vector) AS similarity
          FROM "knowledge_chunks" kc
          WHERE kc."knowledgeBaseId" = ${knowledgeBaseId}
            AND kc.embedding IS NOT NULL
          ORDER BY kc.embedding <=> ${vector}::vector
          LIMIT ${topK}
        `;
  }

  /**
   * The `topK` chunks closest to `embedding` across this user's active personal bases (no workspace base),
   * closest first; chunks without an embedding are left out.
   */
  searchPersonalChunks(
    userId: string,
    embedding: readonly number[],
    topK: number,
    tx?: DbTransaction,
  ) {
    const vector = `[${embedding.join(",")}]`;
    return (tx ?? this.prisma).$queryRaw<ChunkSearchRow[]>`
        SELECT
          kc.id,
          kc.content,
          kc.metadata,
          kc."tokenCount" AS token_count,
          kc."knowledgeBaseId" AS knowledge_base_id,
          1 - (kc.embedding <=> ${vector}::vector) AS similarity
        FROM "knowledge_chunks" kc
        INNER JOIN "knowledge_bases" kb ON kb.id = kc."knowledgeBaseId"
        WHERE kb."userId" = ${userId}
          AND kb.workspace_id IS NULL
          AND kb.active = true
          AND kc.embedding IS NOT NULL
        ORDER BY kc.embedding <=> ${vector}::vector
        LIMIT ${topK}
      `;
  }

  /** The `topK` chunks of this base with a similarity to `embedding` of at least `threshold`, closest first. */
  searchSystemChunks(
    knowledgeBaseId: string,
    embedding: readonly number[],
    threshold: number,
    topK: number,
    tx?: DbTransaction,
  ) {
    const vector = `[${embedding.join(",")}]`;
    return (tx ?? this.prisma).$queryRaw<SystemChunkSearchRow[]>`
        SELECT
          kc.content,
          1 - (kc.embedding <=> ${vector}::vector) AS similarity
        FROM "knowledge_chunks" kc
        WHERE kc."knowledgeBaseId" = ${knowledgeBaseId}
          AND kc.embedding IS NOT NULL
          AND 1 - (kc.embedding <=> ${vector}::vector) >= ${threshold}
        ORDER BY kc.embedding <=> ${vector}::vector
        LIMIT ${topK}
      `;
  }
}
