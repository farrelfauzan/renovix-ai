import { Module } from "@nestjs/common";
import { KnowledgeService } from "./service/knowledge.service";
import { KnowledgeController } from "./controller/knowledge.controller";
import { EmbeddingService } from "./service/embedding.service";
import { S3Service } from "./service/s3.service";
import { SystemKnowledgeService } from "./service/system-knowledge.service";

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
