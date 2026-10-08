import { Injectable, Logger, OnApplicationBootstrap } from "@nestjs/common";
import { Cron } from "@nestjs/schedule";
import { ConfigService } from "@nestjs/config";
import { Prisma } from "@generated/prisma/client.js";
import {
  S3Client,
  ListObjectsV2Command,
  GetObjectCommand,
} from "@aws-sdk/client-s3";
import { PrismaService } from "../prisma/prisma.service";
import { EmbeddingService } from "./embedding.service";
import { chunkMarkdown } from "./markdown-chunker";

@Injectable()
export class SystemKnowledgeService implements OnApplicationBootstrap {
  private readonly logger = new Logger(SystemKnowledgeService.name);
  private readonly s3Client: S3Client;
  private readonly bucket: string;
  private readonly prefix: string;
  cdnBaseUrl: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly embeddingService: EmbeddingService,
    private readonly configService: ConfigService,
  ) {
    this.bucket = this.configService.getOrThrow<string>("S3_BUCKET");
    this.prefix =
      this.configService.get<string>("SYSTEM_KB_S3_PREFIX") ??
      "renovix-rag-docs";
    this.cdnBaseUrl = this.configService.get<string>("SYSTEM_KB_CDN_URL") ?? "";

    const endpoint = this.configService.get<string>("S3_ENDPOINT") || undefined;
    const configuredRegion = this.configService.getOrThrow<string>("S3_REGION");
    const isGcsEndpoint = endpoint?.includes("storage.googleapis.com");
    const region = isGcsEndpoint ? "auto" : configuredRegion;

    this.s3Client = new S3Client({
      region,
      endpoint,
      forcePathStyle: !!endpoint,
      requestChecksumCalculation: "WHEN_REQUIRED",
      responseChecksumValidation: "WHEN_REQUIRED",
      credentials: {
        accessKeyId: this.configService.getOrThrow<string>("S3_ACCESS_KEY_ID"),
        secretAccessKey: this.configService.getOrThrow<string>(
          "S3_SECRET_ACCESS_KEY",
        ),
      },
    });
  }

  async onApplicationBootstrap() {
    try {
      await this.sync();
    } catch (err) {
      this.logger.error("System KB sync failed on startup", err);
    }
  }

  /** Sync every hour */
  @Cron("0 * * * *")
  async handleCron() {
    await this.sync();
  }

  /** Main sync: list S3 .md files, diff by ETag, re-chunk changed files */
  async sync(): Promise<{ synced: number; unchanged: number }> {
    this.logger.log("Starting system knowledge base sync...");

    // Ensure the system KB exists
    const kb = await this.getOrCreateSystemKB();

    // List all .md files in the bucket
    const objects = await this.listMarkdownFiles();
    if (objects.length === 0) {
      this.logger.log("No markdown files found in system KB bucket");
      return { synced: 0, unchanged: 0 };
    }

    // Get stored ETags from existing chunk metadata
    const existingEtags = await this.getStoredEtags(kb.id);

    let synced = 0;
    let unchanged = 0;

    for (const obj of objects) {
      const key = obj.Key!;
      const etag = obj.ETag ?? "";

      // Skip if ETag matches (file unchanged)
      if (existingEtags.get(key) === etag) {
        unchanged++;
        continue;
      }

      // Download, chunk, embed, and upsert
      await this.syncFile(kb.id, key, etag);
      synced++;
    }

    this.logger.log(
      `System KB sync complete: ${synced} synced, ${unchanged} unchanged`,
    );
    return { synced, unchanged };
  }

  private async getOrCreateSystemKB() {
    const existing = await this.prisma.knowledgeBase.findFirst({
      where: { isSystem: true },
    });

    if (existing) return existing;

    return this.prisma.knowledgeBase.create({
      data: {
        name: "Renovix AI System Knowledge",
        description: "System knowledge base for Renovix AI product information",
        isSystem: true,
        active: true,
      },
    });
  }

  private async listMarkdownFiles() {
    const result = await this.s3Client.send(
      new ListObjectsV2Command({
        Bucket: this.bucket,
        Prefix: `${this.prefix}/`,
      }),
    );

    return (result.Contents ?? []).filter(
      (obj) => obj.Key?.endsWith(".md") && obj.Size && obj.Size > 0,
    );
  }

  private async getStoredEtags(kbId: string): Promise<Map<string, string>> {
    const chunks = await this.prisma.knowledgeChunk.findMany({
      where: { knowledgeBaseId: kbId },
      select: { metadata: true },
    });

    const map = new Map<string, string>();
    for (const chunk of chunks) {
      const meta = chunk.metadata as Record<string, unknown> | null;
      if (meta?.s3Key && meta?.etag) {
        map.set(meta.s3Key as string, meta.etag as string);
      }
    }
    return map;
  }

  private async syncFile(kbId: string, key: string, etag: string) {
    this.logger.log(`Syncing: ${key}`);

    // Download from S3
    const response = await this.s3Client.send(
      new GetObjectCommand({ Bucket: this.bucket, Key: key }),
    );

    const stream = response.Body as NodeJS.ReadableStream;
    const buffers: Buffer[] = [];
    for await (const chunk of stream) {
      buffers.push(Buffer.from(chunk));
    }
    const content = Buffer.concat(buffers).toString("utf-8");

    // Chunk the markdown
    const chunks = chunkMarkdown(content, key);
    if (chunks.length === 0) {
      this.logger.warn(`No chunks produced from ${key}`);
      return;
    }

    // Delete old chunks for this file
    await this.prisma.$executeRaw(
      Prisma.sql`
        DELETE FROM "knowledge_chunks"
        WHERE "knowledgeBaseId" = ${kbId}
          AND metadata->>'s3Key' = ${key}
      `,
    );

    // Generate embeddings in batch
    const texts = chunks.map((c) => c.content);
    const embeddings = await this.embeddingService.embed(texts);

    // Insert new chunks with embeddings
    await this.prisma.$transaction(
      chunks.map((chunk, i) => {
        const vector = `[${embeddings[i].embedding.join(",")}]`;
        const metadata = { ...chunk.metadata, s3Key: key, etag };

        return this.prisma.$executeRaw(
          Prisma.sql`
            INSERT INTO "knowledge_chunks" (id, "knowledgeBaseId", content, metadata, embedding, "tokenCount", "createdAt")
            VALUES (
              gen_random_uuid(),
              ${kbId},
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

    this.logger.log(`  ✓ ${key} → ${chunks.length} chunks`);
  }

  /** Search system KB for relevant context (used by chat flow) */
  async searchSystemKB(
    query: string,
    options?: { topK?: number; threshold?: number },
  ): Promise<{ content: string; similarity: number }[]> {
    const topK = options?.topK ?? 3;
    const threshold = options?.threshold ?? 0.7;

    const kb = await this.prisma.knowledgeBase.findFirst({
      where: { isSystem: true, active: true },
    });

    if (!kb) return [];

    const { embedding } = await this.embeddingService.embedSingle(query);
    const vector = `[${embedding.join(",")}]`;

    const results = await this.prisma.$queryRaw<
      { content: string; similarity: number }[]
    >(
      Prisma.sql`
        SELECT
          kc.content,
          1 - (kc.embedding <=> ${vector}::vector) AS similarity
        FROM "knowledge_chunks" kc
        WHERE kc."knowledgeBaseId" = ${kb.id}
          AND kc.embedding IS NOT NULL
          AND vector_dims(kc.embedding) = vector_dims(${vector}::vector)
          AND 1 - (kc.embedding <=> ${vector}::vector) >= ${threshold}
        ORDER BY kc.embedding <=> ${vector}::vector
        LIMIT ${topK}
      `,
    );

    return results.map((r) => ({
      content: r.content,
      similarity: Number(r.similarity),
    }));
  }
}
