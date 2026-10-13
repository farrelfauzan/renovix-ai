import { Module } from "@nestjs/common";
import { UserMemoryService } from "./service/user-memory.service";
import { MemoryExtractionService } from "./service/memory-extraction.service";
import { MemoryPolicyService } from "./service/memory-policy.service";
import { ProvidersModule } from "../providers/providers.module";

@Module({
  imports: [ProvidersModule],
  providers: [UserMemoryService, MemoryExtractionService, MemoryPolicyService],
  exports: [UserMemoryService, MemoryExtractionService, MemoryPolicyService],
})
export class MemoryModule {}
