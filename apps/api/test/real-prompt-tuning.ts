import { PromptTuningService } from "../src/app/chat/service/prompt-tuning.service";
import { PromptTemplateService } from "../src/app/chat/service/prompt-template.service";
import { SystemKnowledgeService } from "../src/app/knowledge/service/system-knowledge.service";
import { KnowledgeService } from "../src/app/knowledge/service/knowledge.service";
import { S3Service } from "../src/app/knowledge/service/s3.service";
import { EmbeddingService } from "../src/app/knowledge/service/embedding.service";
import { UserMemoryService } from "../src/app/memory/service/user-memory.service";

/** Dummy configuration the real knowledge services read at construction (no value is real; nothing is called). */
const TUNING_ENV = {
  S3_BUCKET: "rx22-test-bucket",
  S3_REGION: "us-east-1",
  S3_ACCESS_KEY_ID: "rx22-marker-not-a-key",
  S3_SECRET_ACCESS_KEY: "rx22-marker-not-a-secret",
  S3_CDN_DOMAIN: "cdn.test.invalid",
  EMBEDDING_API_KEY: "rx22-marker-not-an-embedding-key",
} as const;

/**
 * The real prompt tuning and everything it calls (RX-22 review B1): the system and user knowledge searches with the
 * real EmbeddingService, whose `embedSingle` a test spies on. Sets the dummy configuration above; returns the
 * providers and a function that restores the environment.
 */
export function realPromptTuning() {
  const saved = Object.keys(TUNING_ENV).map((key) => [key, process.env[key]] as const);
  Object.assign(process.env, TUNING_ENV);
  const restoreEnv = () =>
    saved.forEach(([key, value]) => (value === undefined ? delete process.env[key] : (process.env[key] = value)));
  const providers = [
    PromptTuningService,
    PromptTemplateService,
    SystemKnowledgeService,
    KnowledgeService,
    S3Service,
    EmbeddingService,
    UserMemoryService,
  ];
  return { providers, restoreEnv };
}
