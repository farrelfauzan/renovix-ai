import { Injectable } from "@nestjs/common";
import type { Prisma } from "@generated/prisma/client.js";
import type { DbTransaction } from "../../prisma/db-transaction";
import { PrismaService } from "../../prisma/prisma.service";

/** The queries on `packages` and `package_versions` (RX-86). Versions are only ever inserted. */
@Injectable()
export class PackageRepository {
  constructor(private readonly prisma: PrismaService) {}

  /** The package with this name. */
  findByName(name: string, tx?: DbTransaction) {
    return (tx ?? this.prisma).package.findUnique({ where: { name } });
  }

  /** Creates a package. */
  create(data: Prisma.PackageCreateInput, tx?: DbTransaction) {
    return (tx ?? this.prisma).package.create({ data });
  }

  /** Updates the package with this id. */
  update(id: string, data: Prisma.PackageUpdateInput, tx?: DbTransaction) {
    return (tx ?? this.prisma).package.update({ where: { id }, data });
  }

  /** The package's version with the highest number, if it has one. */
  findLatestVersion(packageId: string, tx?: DbTransaction) {
    return (tx ?? this.prisma).packageVersion.findFirst({ where: { packageId }, orderBy: { versionNumber: "desc" } });
  }

  /** The package version with this id. */
  findVersionById(id: string, tx?: DbTransaction) {
    return (tx ?? this.prisma).packageVersion.findUnique({ where: { id } });
  }

  /** Inserts a package version. */
  createVersion(data: Prisma.PackageVersionUncheckedCreateInput, tx?: DbTransaction) {
    return (tx ?? this.prisma).packageVersion.create({ data });
  }
}
