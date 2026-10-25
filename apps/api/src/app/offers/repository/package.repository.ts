import { Injectable } from "@nestjs/common";
import { Prisma } from "../../../generated/prisma/client.js";
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

  /** Every packages in display order, each with all its versions, newest first (RNX-226 admin list). */
  findAllWithVersions() {
    return this.prisma.package.findMany({ orderBy: { displayOrder: "asc" }, include: { versions: { orderBy: { versionNumber: "desc" } } } });
  }

  /** The package with this id, with all its versions, newest first. */
  findByIdWithVersions(id: string, tx?: DbTransaction) {
    return (tx ?? this.prisma).package.findUnique({ where: { id }, include: { versions: { orderBy: { versionNumber: "desc" } } } });
  }

  /** The package's version with the highest number, if it has one. */
  findLatestVersion(packageId: string, tx?: DbTransaction) {
    return (tx ?? this.prisma).packageVersion.findFirst({ where: { packageId }, orderBy: { versionNumber: "desc" } });
  }

  /** The package version with this id. */
  findVersionById(id: string, tx?: DbTransaction) {
    return (tx ?? this.prisma).packageVersion.findUnique({ where: { id } });
  }

  /**
   * The active and visible packages in display order, each with its current version (the highest version number
   * already in effect at `now`), in one call whatever the number of packages (RNX-53 price list).
   */
  findListedWithCurrentVersion(now: Date) {
    return this.prisma.package.findMany({
      where: { active: true, visible: true },
      orderBy: { displayOrder: "asc" },
      include: { versions: { where: { effectiveFrom: { lte: now } }, orderBy: { versionNumber: "desc" }, take: 1 } },
    });
  }

  findNextListedAfter(displayOrder: number | null, limit: "maxAgents" | "maxConnectedTools", current: number, now: Date, tx?: DbTransaction) {
    const db = tx ?? this.prisma;
    const column = limit === "maxAgents" ? Prisma.raw('"max_agents"') : Prisma.raw('"max_connected_tools"');
    return db.$queryRaw<Array<{ name: string; displayOrder: number; currentLimit: number }>>`
      SELECT p.name, p.display_order AS "displayOrder", current_version."currentLimit"
      FROM packages p
      CROSS JOIN LATERAL (
        SELECT pv.${column} AS "currentLimit"
        FROM package_versions pv
        WHERE pv.package_id = p.id AND pv.effective_from <= ${now}
        ORDER BY pv.version_number DESC
        LIMIT 1
      ) current_version
      WHERE p.active = true AND p.visible = true
        AND (${displayOrder}::integer IS NULL OR p.display_order > ${displayOrder})
        AND current_version."currentLimit" > ${current}
      ORDER BY p.display_order ASC, p.id ASC
      LIMIT 1
    `;
  }

  /** The active, visible package with this id and its current version (the highest version number in effect at `now`), for a checkout (RNX-35). */
  findPurchasable(id: string, now: Date) {
    return this.prisma.package.findFirst({
      where: { id, active: true, visible: true },
      include: { versions: { where: { effectiveFrom: { lte: now } }, orderBy: { versionNumber: "desc" }, take: 1 } },
    });
  }

  /** Inserts a package version. */
  createVersion(data: Prisma.PackageVersionUncheckedCreateInput, tx?: DbTransaction) {
    return (tx ?? this.prisma).packageVersion.create({ data });
  }
}
