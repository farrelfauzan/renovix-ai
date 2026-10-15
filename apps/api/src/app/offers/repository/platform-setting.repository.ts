import { Injectable } from "@nestjs/common";
import type { Prisma } from "@generated/prisma/client.js";
import type { DbTransaction } from "../../prisma/db-transaction";
import { PrismaService } from "../../prisma/prisma.service";

/** The queries on `platform_settings` (RX-86). Values are validated by the service before they get here. */
@Injectable()
export class PlatformSettingRepository {
  constructor(private readonly prisma: PrismaService) {}

  /** The setting with this name, if it is set. */
  findByName(name: string, tx?: DbTransaction) {
    return (tx ?? this.prisma).platformSetting.findUnique({ where: { name } });
  }

  /** Writes the setting's value, creating its row when it is not set yet. */
  upsert(name: string, value: Prisma.InputJsonValue, tx: DbTransaction) {
    return tx.platformSetting.upsert({ where: { name }, create: { name, value }, update: { value } });
  }
}
