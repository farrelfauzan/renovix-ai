// System knowledge sync (RNX-91, step f of `bun run seed`). Runs SystemKnowledgeService.sync() once, the same
// call the API makes at startup and hourly: it lists the system KB's S3 bucket, chunks and embeds changed files.
// Needs S3_* (and the embedding key, or LLM_PROVIDER=fake). Writes to the database DATABASE_URL names.
import "dotenv/config";
import "reflect-metadata";
import { ConfigService } from "@nestjs/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../apps/api/src/generated/prisma/client.js";
import type { PrismaService } from "../apps/api/src/app/prisma/prisma.service";
import { KnowledgeBaseRepository } from "../apps/api/src/app/knowledge/repository/knowledge-base.repository";
import { KnowledgeChunkRepository } from "../apps/api/src/app/knowledge/repository/knowledge-chunk.repository";
import { EmbeddingService } from "../apps/api/src/app/knowledge/service/embedding.service";
import { SystemKnowledgeService } from "../apps/api/src/app/knowledge/service/system-knowledge.service";

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) }) as unknown as PrismaService;
const config = new ConfigService(process.env);
try {
  const service = new SystemKnowledgeService(new EmbeddingService(config), config, new KnowledgeBaseRepository(prisma), new KnowledgeChunkRepository(prisma));
  const { synced, unchanged } = await service.sync();
  console.log(`System knowledge sync: ${synced} synced, ${unchanged} unchanged.`);
} finally {
  await prisma.$disconnect();
}
