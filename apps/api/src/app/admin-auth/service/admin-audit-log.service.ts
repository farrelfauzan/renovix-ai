import { Injectable } from "@nestjs/common";
import { AdminAuditLogRepository } from "../repository/admin-audit-log.repository";
import type { AdminIdentity } from "../types/admin-identity";
import type { AuditLogCursor } from "../types/audit-log-cursor";
import type { AuditLogExport } from "../types/audit-log-export";
import type { AuditLogFilters } from "../types/audit-log-filters";
import type { AuditLogPage } from "../types/audit-log-page";
import type { AuditLogRecord } from "../types/audit-log-record";
import { encodeAuditLogCursor } from "../utils/encode-audit-log-cursor";
import { toAuditLogCsvCells } from "../utils/to-audit-log-csv-cells";
import { toAuditLogRow } from "../utils/to-audit-log-row";
import { toCsvLine } from "../utils/to-csv-line";
import { PiiRevealService } from "./pii-reveal.service";

/** Rows per page of the audit log screen (PRD 09 §5). */
const PAGE_SIZE = 50;
/** Rows the CSV export reads per query: never the whole log at once. */
const EXPORT_BATCH_SIZE = 500;
const CSV_HEADER = ["id", "created_at", "admin_id", "admin_email", "resource", "action", "before", "after", "reason", "effective_at"];

const cursorOf = (record: AuditLogRecord): AuditLogCursor => ({ createdAt: record.cursorAt, id: record.id });

/**
 * The audit log screen and its CSV export (RX-164, PRD 09 F11 and F16). Personal data in before, after
 * and reason is masked unless the admin's role holds `users:read_pii` (PRD 09 §5); with it the values are
 * shown as recorded.
 */
@Injectable()
export class AdminAuditLogService {
  constructor(
    private readonly auditLog: AdminAuditLogRepository,
    private readonly pii: PiiRevealService,
  ) {}

  /** One page: up to 50 rows newest first after `cursor`, and the next page's cursor (null on the last page). */
  async listPage(admin: AdminIdentity, filters: AuditLogFilters, cursor?: AuditLogCursor): Promise<AuditLogPage> {
    const showPii = await this.pii.holdsReadPii(admin);
    const records = await this.auditLog.findPage(filters, cursor, PAGE_SIZE + 1);
    const page = records.slice(0, PAGE_SIZE);
    const hasMore = records.length > PAGE_SIZE;
    return {
      rows: page.map((record) => toAuditLogRow(record, showPii)),
      nextCursor: hasMore ? encodeAuditLogCursor(cursorOf(page[page.length - 1])) : null,
    };
  }

  /**
   * The CSV export of every row matching `filters`, and the change its audit row records (PRD 09 F16): the
   * filters and whether personal data was unmasked, never the exported rows. Nothing is read here: the CSV
   * is read batch by batch while it is streamed.
   */
  async prepareExport(admin: AdminIdentity, filters: AuditLogFilters): Promise<AuditLogExport> {
    const showPii = await this.pii.holdsReadPii(admin);
    const change = {
      before: {},
      after: {
        adminId: filters.adminId ?? null,
        resource: filters.resource ?? null,
        action: filters.action ?? null,
        from: filters.from?.toISOString() ?? null,
        to: filters.to?.toISOString() ?? null,
        personalDataUnmasked: showPii,
      },
    };
    return { change, csv: this.readCsv(filters, showPii) };
  }

  /**
   * The header line, then one string per batch of up to 500 rows, with the same keyset query as the
   * screen. A stream built on it stops reading at the next batch once it is destroyed (client gone).
   */
  private async *readCsv(filters: AuditLogFilters, showPii: boolean): AsyncGenerator<string> {
    yield toCsvLine(CSV_HEADER);
    let cursor: AuditLogCursor | undefined;
    do {
      const batch = await this.auditLog.findPage(filters, cursor, EXPORT_BATCH_SIZE);
      if (batch.length) yield batch.map((record) => toCsvLine(toAuditLogCsvCells(toAuditLogRow(record, showPii)))).join("");
      cursor = batch.length === EXPORT_BATCH_SIZE ? cursorOf(batch[batch.length - 1]) : undefined;
    } while (cursor);
  }
}
