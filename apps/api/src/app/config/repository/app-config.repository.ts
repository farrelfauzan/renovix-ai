import { Injectable } from "@nestjs/common";
import type { AppConfig } from "@generated/prisma/client.js";
import type { DbTransaction } from "../../prisma/db-transaction";
import { PrismaService } from "../../prisma/prisma.service";

/** The queries on `app_configs` (RX-21): key/value rows the price refresh reads; the web search policy and usage (RNX-140). */
@Injectable()
export class AppConfigRepository {
  constructor(private readonly prisma: PrismaService) {}

  /** One config value by its exact key. */
  findValue(key: string) {
    return this.prisma.appConfig
      .findUnique({ where: { key }, select: { value: true } })
      .then((row) => row?.value ?? null);
  }

  /** Every config row whose key starts with the prefix. */
  findValuesByKeyPrefix(prefix: string) {
    return this.prisma.appConfig.findMany({
      where: { key: { startsWith: prefix } },
      select: { key: true, value: true },
    });
  }

  /** Stores the value under its exact key, or replaces the value of that key (RNX-140: the web search policy and usage). */
  upsertValue(key: string, value: string, tx?: DbTransaction): Promise<AppConfig> {
    return (tx ?? this.prisma).appConfig.upsert({
      where: { key },
      create: { key, value },
      update: { value },
    });
  }
}
