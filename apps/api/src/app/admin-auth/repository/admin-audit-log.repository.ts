import { Injectable } from "@nestjs/common";
import { Prisma } from "@generated/prisma/client.js";
import type { DbTransaction } from "../../prisma/db-transaction";
import { PrismaService } from "../../prisma/prisma.service";
import type { AdminAuditEntry } from "../types/admin-audit-entry";
import type { AuditLogCursor } from "../types/audit-log-cursor";
import type { AuditLogFilters } from "../types/audit-log-filters";
import type { AuditLogRecord } from "../types/audit-log-record";

/**
 * The queries on `admin_audit_log` (RX-97, D57). Insert and read only: the table is append-only, and the
 * database refuses every UPDATE and DELETE on it (trigger "admin_audit_log_append_only").
 */
@Injectable()
export class AdminAuditLogRepository {
  constructor(private readonly prisma: PrismaService) {}

  /** Writes one audit row. */
  async create(entry: AdminAuditEntry, tx?: DbTransaction): Promise<void> {
    await (tx ?? this.prisma).adminAuditLog.create({ data: entry });
  }

  /**
   * Up to `limit` rows matching `filters`, newest first by (created_at DESC, id DESC), after `cursor`
   * when given (RX-164). Keyset paging, no OFFSET: a deep page costs what the first one does
   * (indexes of migration 20261015200000_audit_read_permission). Raw SQL because the cursor compares
   * created_at to the microsecond, which a Prisma Date filter (milliseconds) cannot.
   */
  findPage(filters: AuditLogFilters, cursor: AuditLogCursor | undefined, limit: number): Promise<AuditLogRecord[]> {
    const conditions = [
      filters.adminId === undefined ? undefined : Prisma.sql`l."admin_id" = ${filters.adminId}`,
      filters.resource === undefined ? undefined : Prisma.sql`l."resource" = ${filters.resource}`,
      filters.action === undefined ? undefined : Prisma.sql`l."action" = ${filters.action}`,
      filters.from === undefined ? undefined : Prisma.sql`l."created_at" >= ${filters.from}`,
      filters.to === undefined ? undefined : Prisma.sql`l."created_at" < ${filters.to}`,
      cursor === undefined ? undefined : Prisma.sql`(l."created_at", l."id") < (${cursor.createdAt}::timestamptz, ${cursor.id})`,
    ].filter((condition): condition is Prisma.Sql => condition !== undefined);
    const where = conditions.length ? Prisma.join(conditions, " AND ") : Prisma.sql`TRUE`;
    return this.prisma.$queryRaw<AuditLogRecord[]>`
      SELECT l."id", l."admin_id" AS "adminId", a."email" AS "adminEmail", l."resource", l."action",
        l."before", l."after", l."reason", l."effective_at" AS "effectiveAt", l."created_at" AS "createdAt",
        to_char(l."created_at" AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS "cursorAt"
      FROM "admin_audit_log" l
      JOIN "admin_users" a ON a."id" = l."admin_id"
      WHERE ${where}
      ORDER BY l."created_at" DESC, l."id" DESC
      LIMIT ${limit}`;
  }
}
