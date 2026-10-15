import { Injectable } from "@nestjs/common";
import type { Prisma } from "@generated/prisma/client.js";
import type { DbTransaction } from "../../prisma/db-transaction";
import { PrismaService } from "../../prisma/prisma.service";

/** The queries on `top_up_packs` and `top_up_pack_versions` (RX-86). Versions are only ever inserted. */
@Injectable()
export class TopUpPackRepository {
  constructor(private readonly prisma: PrismaService) {}

  /** The top-up pack with this name. */
  findByName(name: string, tx?: DbTransaction) {
    return (tx ?? this.prisma).topUpPack.findUnique({ where: { name } });
  }

  /** Creates a top-up pack. */
  create(data: Prisma.TopUpPackCreateInput, tx?: DbTransaction) {
    return (tx ?? this.prisma).topUpPack.create({ data });
  }

  /** Updates the top-up pack with this id. */
  update(id: string, data: Prisma.TopUpPackUpdateInput, tx?: DbTransaction) {
    return (tx ?? this.prisma).topUpPack.update({ where: { id }, data });
  }

  /** The pack's version with the highest number, if it has one. */
  findLatestVersion(packId: string, tx?: DbTransaction) {
    return (tx ?? this.prisma).topUpPackVersion.findFirst({ where: { packId }, orderBy: { versionNumber: "desc" } });
  }

  /** The top-up pack version with this id. */
  findVersionById(id: string, tx?: DbTransaction) {
    return (tx ?? this.prisma).topUpPackVersion.findUnique({ where: { id } });
  }

  /** Inserts a top-up pack version. */
  createVersion(data: Prisma.TopUpPackVersionUncheckedCreateInput, tx?: DbTransaction) {
    return (tx ?? this.prisma).topUpPackVersion.create({ data });
  }
}
