import { Injectable } from "@nestjs/common";
import type { DbTransaction } from "../../prisma/db-transaction";
import { PrismaService } from "../../prisma/prisma.service";
import type { AdminAuditEntry } from "../types/admin-audit-entry";

/**
 * The queries on `admin_audit_log` (RX-97, D57). Insert only: the table is append-only, and the database
 * refuses every UPDATE and DELETE on it (trigger "admin_audit_log_append_only").
 */
@Injectable()
export class AdminAuditLogRepository {
  constructor(private readonly prisma: PrismaService) {}

  /** Writes one audit row. */
  async create(entry: AdminAuditEntry, tx?: DbTransaction): Promise<void> {
    await (tx ?? this.prisma).adminAuditLog.create({ data: entry });
  }
}
