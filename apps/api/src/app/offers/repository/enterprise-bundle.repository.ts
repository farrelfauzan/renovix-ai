import { Injectable } from "@nestjs/common";
import type { Prisma } from "@generated/prisma/client.js";
import type { DbTransaction } from "../../prisma/db-transaction";
import { PrismaService } from "../../prisma/prisma.service";

/** The queries on `enterprise_bundles` and `enterprise_bundle_versions` (RX-86). Versions are only ever inserted. */
@Injectable()
export class EnterpriseBundleRepository {
  constructor(private readonly prisma: PrismaService) {}

  /** The Enterprise bundle with this name. */
  findByName(name: string, tx?: DbTransaction) {
    return (tx ?? this.prisma).enterpriseBundle.findUnique({ where: { name } });
  }

  /** Creates an Enterprise bundle. */
  create(data: Prisma.EnterpriseBundleCreateInput, tx?: DbTransaction) {
    return (tx ?? this.prisma).enterpriseBundle.create({ data });
  }

  /** Updates the Enterprise bundle with this id. */
  update(id: string, data: Prisma.EnterpriseBundleUpdateInput, tx?: DbTransaction) {
    return (tx ?? this.prisma).enterpriseBundle.update({ where: { id }, data });
  }

  /** Every Enterprise bundles by name, each with all its versions, newest first (RNX-226 admin list). */
  findAllWithVersions() {
    return this.prisma.enterpriseBundle.findMany({ orderBy: { name: "asc" }, include: { versions: { orderBy: { versionNumber: "desc" } } } });
  }

  /** The Enterprise bundle with this id, with all its versions, newest first. */
  findByIdWithVersions(id: string, tx?: DbTransaction) {
    return (tx ?? this.prisma).enterpriseBundle.findUnique({ where: { id }, include: { versions: { orderBy: { versionNumber: "desc" } } } });
  }

  /** The bundle's version with the highest number, if it has one. */
  findLatestVersion(bundleId: string, tx?: DbTransaction) {
    return (tx ?? this.prisma).enterpriseBundleVersion.findFirst({ where: { bundleId }, orderBy: { versionNumber: "desc" } });
  }

  /** Inserts an Enterprise bundle version. */
  createVersion(data: Prisma.EnterpriseBundleVersionUncheckedCreateInput, tx?: DbTransaction) {
    return (tx ?? this.prisma).enterpriseBundleVersion.create({ data });
  }
}
