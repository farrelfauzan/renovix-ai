import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
} from "@nestjs/common";
import { Prisma } from "@generated/prisma/client.js";
import type { KnowledgeBase } from "@generated/prisma/client.js";
import { PrismaService } from "../../prisma/prisma.service";
import { EmbeddingService } from "../../knowledge/service/embedding.service";
import { S3Service } from "../../knowledge/service/s3.service";
import { chunkMarkdown } from "../../knowledge/utils/markdown-chunker";
import { KnowledgeChunkRepository } from "../../knowledge/repository/knowledge-chunk.repository";
import { WorkspaceMemberRepository } from "../repository/workspace-member.repository";
import { WorkspaceQuotaService } from "./workspace-quota.service";

@Injectable()
export class WorkspaceKnowledgeService {
  private readonly logger = new Logger(WorkspaceKnowledgeService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly embeddingService: EmbeddingService,
    private readonly s3Service: S3Service,
    private readonly knowledgeChunks: KnowledgeChunkRepository,
    private readonly workspaceMembers: WorkspaceMemberRepository,
    private readonly quotaService: WorkspaceQuotaService,
  ) {}

  /**
   * Whether this user may search this knowledge base in an agent run (RX-116, D71). A personal base: only its owner.
   * A workspace base: a current (active) member of its workspace, and the workspace owner's plan allows collaboration
   * (the owner always passes, `WorkspaceQuotaService.isCollaborationAllowed`). The one place this is decided, so
   * other run paths reuse it.
   */
  async canSearchKnowledgeBase(
    userId: string,
    knowledgeBase: Pick<KnowledgeBase, "userId" | "workspaceId">,
  ): Promise<boolean> {
    if (!knowledgeBase.workspaceId) return knowledgeBase.userId === userId;
    const member = await this.workspaceMembers.findMembership(knowledgeBase.workspaceId, userId);
    if (member?.status !== "active") return false;
    return this.quotaService.isCollaborationAllowed(knowledgeBase.workspaceId, userId);
  }

  async createKnowledgeBase(
    workspaceId: string,
    userId: string,
    data: { name: string; description?: string },
  ) {
    return this.prisma.knowledgeBase.create({
      data: {
        workspaceId,
        userId,
        name: data.name,
        description: data.description ?? null,
      },
    });
  }

  async listKnowledgeBases(workspaceId: string) {
    return this.prisma.knowledgeBase.findMany({
      where: { workspaceId, active: true },
      orderBy: { createdAt: "desc" },
      include: { _count: { select: { chunks: true } } },
    });
  }

  async getKnowledgeBase(workspaceId: string, id: string) {
    const kb = await this.prisma.knowledgeBase.findUnique({
      where: { id },
      include: { _count: { select: { chunks: true } } },
    });

    if (!kb || kb.workspaceId !== workspaceId) {
      throw new NotFoundException("Knowledge base not found");
    }

    return kb;
  }

  async deleteKnowledgeBase(workspaceId: string, id: string) {
    await this.getKnowledgeBase(workspaceId, id);
    await this.prisma.knowledgeBase.delete({ where: { id } });
  }

  async uploadMarkdown(
    workspaceId: string,
    knowledgeBaseId: string,
    userId: string,
    file: { filename: string; buffer: Buffer },
  ) {
    const kb = await this.getKnowledgeBase(workspaceId, knowledgeBaseId);

    if (!file.filename.endsWith(".md")) {
      throw new BadRequestException("Only .md files are supported");
    }

    const content = file.buffer.toString("utf-8");
    const chunks = chunkMarkdown(content, file.filename);

    if (chunks.length === 0) {
      throw new BadRequestException("File produced no chunks");
    }

    const texts = chunks.map((c) => c.content);
    const embeddings = await this.embeddingService.embed(texts);

    // Upload the original file only now, so a failed chunk or embedding leaves nothing in S3
    const s3Key = this.s3Service.buildKey(
      `workspace-${workspaceId}`,
      kb.id,
      file.filename,
    );
    await this.s3Service.upload(s3Key, file.buffer, "text/markdown");

    let created: unknown[];
    try {
      created = await this.insertUploadedChunks(kb.id, userId, s3Key, chunks, embeddings);
    } catch (err) {
      await this.deleteUploadedFile(s3Key);
      throw err;
    }

    return {
      filename: file.filename,
      chunksInserted: created.length,
    };
  }

  /** Best effort: logs the key only when the delete fails, so the caller still gets the original error. */
  private async deleteUploadedFile(s3Key: string): Promise<void> {
    try {
      await this.s3Service.delete(s3Key);
    } catch {
      this.logger.error(`Could not delete ${s3Key} from S3 after a failed upload`);
    }
  }

  private async insertUploadedChunks(
    knowledgeBaseId: string,
    userId: string,
    s3Key: string,
    chunks: ReturnType<typeof chunkMarkdown>,
    embeddings: Awaited<ReturnType<EmbeddingService["embed"]>>,
  ) {
    return this.prisma.$transaction(
      chunks.map((chunk, i) => {
        const vector = `[${embeddings[i].embedding.join(",")}]`;
        const metadata = { ...chunk.metadata, s3Key, uploadedBy: userId };

        return this.prisma.$executeRaw(
          Prisma.sql`
            INSERT INTO "knowledge_chunks" (id, "knowledgeBaseId", content, metadata, embedding, "tokenCount", "createdAt", embedding_model, embedded_at)
            VALUES (
              gen_random_uuid(),
              ${knowledgeBaseId},
              ${chunk.content},
              ${JSON.stringify(metadata)}::jsonb,
              ${vector}::vector,
              ${embeddings[i].tokenCount},
              now(),
              ${this.embeddingService.modelName},
              now()
            )
          `,
        );
      }),
    );
  }

  async addChunks(
    workspaceId: string,
    knowledgeBaseId: string,
    userId: string,
    chunks: { content: string; metadata?: Record<string, unknown> }[],
  ) {
    const kb = await this.getKnowledgeBase(workspaceId, knowledgeBaseId);

    const texts = chunks.map((c) => c.content);
    const embeddings = await this.embeddingService.embed(texts);

    const created = await this.prisma.$transaction(
      chunks.map((chunk, i) => {
        const vector = `[${embeddings[i].embedding.join(",")}]`;

        return this.prisma.$executeRaw(
          Prisma.sql`
            INSERT INTO "knowledge_chunks" (id, "knowledgeBaseId", content, metadata, embedding, "tokenCount", "createdAt", embedding_model, embedded_at)
            VALUES (
              gen_random_uuid(),
              ${kb.id},
              ${chunk.content},
              ${JSON.stringify({ ...(chunk.metadata ?? {}), addedBy: userId })}::jsonb,
              ${vector}::vector,
              ${embeddings[i].tokenCount},
              now(),
              ${this.embeddingService.modelName},
              now()
            )
          `,
        );
      }),
    );

    return { inserted: created.length };
  }

  async listChunks(
    workspaceId: string,
    knowledgeBaseId: string,
    options?: { limit?: number; offset?: number },
  ) {
    await this.getKnowledgeBase(workspaceId, knowledgeBaseId);

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

  async deleteChunk(
    workspaceId: string,
    knowledgeBaseId: string,
    chunkId: string,
  ) {
    await this.getKnowledgeBase(workspaceId, knowledgeBaseId);

    const chunk = await this.prisma.knowledgeChunk.findUnique({
      where: { id: chunkId },
    });

    if (!chunk || chunk.knowledgeBaseId !== knowledgeBaseId) {
      throw new NotFoundException("Chunk not found");
    }

    await this.prisma.knowledgeChunk.delete({ where: { id: chunkId } });
  }

  async searchWorkspaceKnowledge(workspaceId: string, query: string, topK = 5) {
    const { embedding } = await this.embeddingService.embedSingle(query);
    const vector = `[${embedding.join(",")}]`;

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
          kc."tokenCount" as token_count,
          kc."knowledgeBaseId" as knowledge_base_id,
          1 - (kc.embedding <=> ${vector}::vector) as similarity
        FROM "knowledge_chunks" kc
        JOIN "knowledge_bases" kb ON kb.id = kc."knowledgeBaseId"
        WHERE kb.workspace_id = ${workspaceId}
          AND kb.active = true
          AND kc.embedding_model = ${this.embeddingService.modelName}
        ORDER BY kc.embedding <=> ${vector}::vector
        LIMIT ${topK}
      `,
    );

    return results;
  }

  /**
   * The `topK` chunks of this one workspace base closest to `query` (RX-116). No access check: the caller decides
   * first with `canSearchKnowledgeBase`.
   */
  async searchKnowledgeBase(knowledgeBaseId: string, query: string, topK: number) {
    const { embedding } = await this.embeddingService.embedSingle(query);
    return this.knowledgeChunks.searchChunksInKnowledgeBase(
      knowledgeBaseId,
      embedding,
      this.embeddingService.modelName,
      topK,
    );
  }
}
