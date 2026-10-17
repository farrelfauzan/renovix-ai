import { Injectable } from "@nestjs/common";
import type { DbTransaction } from "../../prisma/db-transaction";
import { PrismaService } from "../../prisma/prisma.service";

/** The queries on `system_prompts` (RX-136). Every method takes the transaction as its optional last argument. */
@Injectable()
export class SystemPromptRepository {
  constructor(private readonly prisma: PrismaService) {}

  /** The active system prompts, highest priority first. */
  listActiveSystemPrompts(tx?: DbTransaction) {
    return (tx ?? this.prisma).systemPrompt.findMany({
      where: { active: true },
      orderBy: { priority: "desc" },
    });
  }
}
