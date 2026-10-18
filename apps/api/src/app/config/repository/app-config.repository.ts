import { Injectable } from "@nestjs/common";
import { PrismaService } from "../../prisma/prisma.service";

/** The queries on `app_configs` (RX-21): key/value rows the price refresh reads. */
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
}
