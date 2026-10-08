import {
  Injectable,
  Logger,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
} from "@nestjs/common";
import { Prisma } from "@generated/prisma/client.js";
import { PrismaService } from "../prisma/prisma.service";
import { EmbeddingService } from "./embedding.service";
import { S3Service } from "./s3.service";
import { chunkMarkdown } from "./markdown-chunker";

@Injectable()
export class KnowledgeService {
  private readonly logger = new Logger(KnowledgeService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly embeddingService: EmbeddingService,
    private readonly s3Service: S3Service,
  ) {}

  // ─── Knowledge Bases ───

  async createKnowledgeBase(
    userId: string,
    data: { name: string; description?: string },
  ) {
    return this.prisma.knowledgeBase.create({
      data: {
        userId,
        name: data.name,
        description: data.description ?? null,
      },
    });
  }

  async listKnowledgeBases(userId: string) {
    return this.prisma.knowledgeBase.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
      include: { _count: { select: { chunks: true } } },
    });
  }

  async getKnowledgeBase(userId: string, id: string) {
    const kb = await this.prisma.knowledgeBase.findUnique({
      where: { id },
      include: { _count: { select: { chunks: true } } },
    });

    if (!kb) throw new NotFoundException("Knowledge base not found");
    if (kb.userId !== userId) throw new ForbiddenException("Access denied");

    return kb;
  }

  async updateKnowledgeBase(
    userId: string,
    id: string,
    data: { name?: string; description?: string; active?: boolean },
  ) {
    const kb = await this.getKnowledgeBase(userId, id);

    return this.prisma.knowledgeBase.update({
      where: { id: kb.id },
      data,
    });
  }

  async deleteKnowledgeBase(userId: string, id: string) {
    const kb = await this.getKnowledgeBase(userId, id);

    await this.prisma.knowledgeBase.delete({ where: { id: kb.id } });
  }

  // ─── Chunks ───

  async uploadMarkdown(
    userId: string,
    knowledgeBaseId: string,
    file: { filename: string; buffer: Buffer },
  ) {
    const kb = await this.getKnowledgeBase(userId, knowledgeBaseId);

    if (!file.filename.endsWith(".md")) {
      throw new BadRequestException("Only .md files are supported");
    }

    // Upload original file to S3
    const s3Key = this.s3Service.buildKey(userId, kb.id, file.filename);
    await this.s3Service.upload(s3Key, file.buffer, "text/markdown");

    // Parse and chunk the markdown
    const content = file.buffer.toString("utf-8");
    const chunks = chunkMarkdown(content, file.filename);

    if (chunks.length === 0) {
      throw new BadRequestException("File produced no chunks");
    }

    // Generate embeddings in batch
    const texts = chunks.map((c) => c.content);
    const embeddings = await this.embeddingService.embed(texts);

    // Insert chunks with embeddings
    const created = await this.prisma.$transaction(
      chunks.map((chunk, i) => {
        const vector = `[${embeddings[i].embedding.join(",")}]`;
        const metadata = { ...chunk.metadata, s3Key };

        return this.prisma.$executeRaw(
          Prisma.sql`
            INSERT INTO "knowledge_chunks" (id, "knowledgeBaseId", content, metadata, embedding, "tokenCount", "createdAt")
            VALUES (
              gen_random_uuid(),
              ${kb.id},
              ${chunk.content},
              ${JSON.stringify(metadata)}::jsonb,
              ${vector}::vector,
              ${embeddings[i].tokenCount},
              now()
            )
          `,
        );
      }),
    );

    this.logger.log(
      `Uploaded ${file.filename} → ${created.length} chunks for KB ${kb.id}`,
    );

    return {
      filename: file.filename,
      s3Key,
      chunksInserted: created.length,
    };
  }

  async addChunks(
    userId: string,
    knowledgeBaseId: string,
    chunks: { content: string; metadata?: Record<string, unknown> }[],
  ) {
    const kb = await this.getKnowledgeBase(userId, knowledgeBaseId);

    // Generate embeddings in batch
    const texts = chunks.map((c) => c.content);
    const embeddings = await this.embeddingService.embed(texts);

    // Insert chunks with embeddings using a transaction
    const created = await this.prisma.$transaction(
      chunks.map((chunk, i) => {
        const vector = `[${embeddings[i].embedding.join(",")}]`;

        return this.prisma.$executeRaw(
          Prisma.sql`
            INSERT INTO "knowledge_chunks" (id, "knowledgeBaseId", content, metadata, embedding, "tokenCount", "createdAt")
            VALUES (
              gen_random_uuid(),
              ${kb.id},
              ${chunk.content},
              ${JSON.stringify(chunk.metadata ?? {})}::jsonb,
              ${vector}::vector,
              ${embeddings[i].tokenCount},
              now()
            )
          `,
        );
      }),
    );

    return { inserted: created.length };
  }

  async listChunks(
    userId: string,
    knowledgeBaseId: string,
    options?: { limit?: number; offset?: number },
  ) {
    await this.getKnowledgeBase(userId, knowledgeBaseId);

    const limit = options?.limit ?? 50;
    const offset = options?.offset ?? 0;

    const [chunks, total] = await Promise.all([
      this.prisma.knowledgeChunk.findMany({
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
      }),
      this.prisma.knowledgeChunk.count({ where: { knowledgeBaseId } }),
    ]);

    return { chunks, total };
  }

  async deleteChunk(userId: string, knowledgeBaseId: string, chunkId: string) {
    await this.getKnowledgeBase(userId, knowledgeBaseId);

    const chunk = await this.prisma.knowledgeChunk.findUnique({
      where: { id: chunkId },
    });

    if (!chunk || chunk.knowledgeBaseId !== knowledgeBaseId) {
      throw new NotFoundException("Chunk not found");
    }

    await this.prisma.knowledgeChunk.delete({ where: { id: chunkId } });
  }

  // ─── Search (Vector Similarity) ───

  async searchChunks(
    userId: string,
    query: string,
    options?: { knowledgeBaseId?: string; topK?: number },
  ) {
    const topK = options?.topK ?? 5;

    // Generate embedding for the query
    const { embedding } = await this.embeddingService.embedSingle(query);
    const vector = `[${embedding.join(",")}]`;

    // Build the similarity search query using safe Prisma.sql tagged template
    // Filter by user's knowledge bases and optionally by specific knowledge base
    if (options?.knowledgeBaseId) {
      // Verify access
      await this.getKnowledgeBase(userId, options.knowledgeBaseId);

      const results = await this.prisma.$queryRaw<
        {
          id: string;
          content: string;
          metadata: unknown;
          token_count: number;
          knowledge_base_id: string;
          similarity: number;
        }[]
      >(
        Prisma.sql`
          SELECT
            kc.id,
            kc.content,
            kc.metadata,
            kc."tokenCount" AS token_count,
            kc."knowledgeBaseId" AS knowledge_base_id,
            1 - (kc.embedding <=> ${vector}::vector) AS similarity
          FROM "knowledge_chunks" kc
          WHERE kc."knowledgeBaseId" = ${options.knowledgeBaseId}
            AND kc.embedding IS NOT NULL
            AND vector_dims(kc.embedding) = vector_dims(${vector}::vector)
          ORDER BY kc.embedding <=> ${vector}::vector
          LIMIT ${topK}
        `,
      );

      return results.map((r) => ({
        id: r.id,
        content: r.content,
        metadata: r.metadata,
        tokenCount: r.token_count,
        knowledgeBaseId: r.knowledge_base_id,
        similarity: Number(r.similarity),
      }));
    }

    // Search across all user's active knowledge bases
    const results = await this.prisma.$queryRaw<
      {
        id: string;
        content: string;
        metadata: unknown;
        token_count: number;
        knowledge_base_id: string;
        similarity: number;
      }[]
    >(
      Prisma.sql`
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
          AND kb.active = true
          AND kc.embedding IS NOT NULL
          AND vector_dims(kc.embedding) = vector_dims(${vector}::vector)
        ORDER BY kc.embedding <=> ${vector}::vector
        LIMIT ${topK}
      `,
    );

    return results.map((r) => ({
      id: r.id,
      content: r.content,
      metadata: r.metadata,
      tokenCount: r.token_count,
      knowledgeBaseId: r.knowledge_base_id,
      similarity: Number(r.similarity),
    }));
  }
}
