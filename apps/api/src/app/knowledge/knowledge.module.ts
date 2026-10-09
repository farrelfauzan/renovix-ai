import { Module } from "@nestjs/common";
import { KnowledgeService } from "./knowledge.service";
import { KnowledgeController } from "./knowledge.controller";
import { EmbeddingService } from "./embedding.service";
import { S3Service } from "./s3.service";
import { SystemKnowledgeService } from "./system-knowledge.service";

@Module({
  controllers: [KnowledgeController],
  providers: [
    KnowledgeService,
    EmbeddingService,
    S3Service,
    SystemKnowledgeService,
  ],
  exports: [
    KnowledgeService,
    EmbeddingService,
    S3Service,
    SystemKnowledgeService,
  ],
})
export class KnowledgeModule {}
