import {
  Injectable,
  Logger,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
} from "@nestjs/common";
import { EmbeddingService } from "./embedding.service";
import { S3Service } from "./s3.service";
import { chunkMarkdown } from "../utils/markdown-chunker";
import { KnowledgeBaseRepository } from "../repository/knowledge-base.repository";
import { KnowledgeChunkRepository } from "../repository/knowledge-chunk.repository";

@Injectable()
export class KnowledgeService {
  private readonly logger = new Logger(KnowledgeService.name);

  constructor(
    private readonly embeddingService: EmbeddingService,
    private readonly s3Service: S3Service,
    private readonly knowledgeBases: KnowledgeBaseRepository,
    private readonly knowledgeChunks: KnowledgeChunkRepository,
  ) {}

  // ─── Knowledge Bases ───

  async createKnowledgeBase(
    userId: string,
    data: { name: string; description?: string },
  ) {
    return this.knowledgeBases.createPersonalKnowledgeBase(
      userId,
      data.name,
      data.description ?? null,
    );
  }

  async listKnowledgeBases(userId: string) {
    return this.knowledgeBases.listPersonalKnowledgeBases(userId);
  }

  async getKnowledgeBase(userId: string, id: string) {
    const kb = await this.knowledgeBases.findKnowledgeBaseWithChunkCount(id);

    // Personal bases only: a workspace base is reached through the workspace
    // routes, which check current membership (RX-113)
    if (!kb || kb.workspaceId) {
      throw new NotFoundException("Knowledge base not found");
    }
    if (kb.userId !== userId) throw new ForbiddenException("Access denied");

    return kb;
  }

  async updateKnowledgeBase(
    userId: string,
    id: string,
    data: { name?: string; description?: string; active?: boolean },
  ) {
    const kb = await this.getKnowledgeBase(userId, id);

    return this.knowledgeBases.updateKnowledgeBase(kb.id, data);
  }

  async deleteKnowledgeBase(userId: string, id: string) {
    const kb = await this.getKnowledgeBase(userId, id);

    await this.knowledgeBases.deleteKnowledgeBase(kb.id);
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
    const created = await this.knowledgeChunks.insertChunks(
      kb.id,
      chunks.map((chunk, i) => ({
        content: chunk.content,
        metadata: { ...chunk.metadata, s3Key },
        embedding: embeddings[i].embedding,
        tokenCount: embeddings[i].tokenCount,
      })),
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
    const created = await this.knowledgeChunks.insertChunks(
      kb.id,
      chunks.map((chunk, i) => ({
        content: chunk.content,
        metadata: chunk.metadata ?? {},
        embedding: embeddings[i].embedding,
        tokenCount: embeddings[i].tokenCount,
      })),
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
      this.knowledgeChunks.listChunks(knowledgeBaseId, limit, offset),
      this.knowledgeChunks.countChunks(knowledgeBaseId),
    ]);

    return { chunks, total };
  }

  async deleteChunk(userId: string, knowledgeBaseId: string, chunkId: string) {
    await this.getKnowledgeBase(userId, knowledgeBaseId);

    const chunk = await this.knowledgeChunks.findChunkById(chunkId);

    if (!chunk || chunk.knowledgeBaseId !== knowledgeBaseId) {
      throw new NotFoundException("Chunk not found");
    }

    await this.knowledgeChunks.deleteChunk(chunkId);
  }

  // ─── Search (Vector Similarity) ───

  async searchChunks(
    userId: string,
    query: string,
    options?: { knowledgeBaseId?: string; topK?: number },
  ) {
    const topK = options?.topK ?? 5;

    // Verify access before paying for an embedding (RX-113)
    if (options?.knowledgeBaseId) {
      await this.getKnowledgeBase(userId, options.knowledgeBaseId);
    }

    // Generate embedding for the query
    const { embedding } = await this.embeddingService.embedSingle(query);

    // Filter by user's knowledge bases and optionally by specific knowledge base
    if (options?.knowledgeBaseId) {
      const results = await this.knowledgeChunks.searchChunksInKnowledgeBase(
        options.knowledgeBaseId,
        embedding,
        topK,
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
    const results = await this.knowledgeChunks.searchPersonalChunks(
      userId,
      embedding,
      topK,
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
