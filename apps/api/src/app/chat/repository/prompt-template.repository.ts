import { Injectable } from "@nestjs/common";
import type { DbTransaction } from "../../prisma/db-transaction";
import { PrismaService } from "../../prisma/prisma.service";

/** The queries on `prompt_templates` (RX-136). Every method takes the transaction as its optional last argument. */
@Injectable()
export class PromptTemplateRepository {
  constructor(private readonly prisma: PrismaService) {}

  /** The active prompt templates, highest priority first. */
  listActivePromptTemplates(tx?: DbTransaction) {
    return (tx ?? this.prisma).promptTemplate.findMany({
      where: { active: true },
      orderBy: { priority: "desc" },
    });
  }
}
