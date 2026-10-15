import { BadRequestException, Controller, Get, Header, Query, Req, StreamableFile } from "@nestjs/common";
import { Readable } from "node:stream";
import { Access } from "../../../common/decorators/access.decorator";
import { AdminAudit } from "../decorator/admin-audit.decorator";
import { AuditLogExportQueryDto } from "../dto/audit-log-export-query.dto";
import { AuditLogQueryDto } from "../dto/audit-log-query.dto";
import { AdminAuditLogService } from "../service/admin-audit-log.service";
import type { AdminRequest } from "../types/admin-request";
import type { AuditLogPage } from "../types/audit-log-page";
import type { AuditedAdminRequest } from "../types/audited-admin-request";

/**
 * The back-office audit log (RX-164, PRD 09 F11), API only. Under /api/v1/admin/audit-log. Both routes
 * need `audit:read` only (D138: Owner, Operations, Finance and Viewer; not Support); the CSV export does
 * not need `exports:create`. Personal data is masked unless the admin holds `users:read_pii`.
 */
@Controller("admin/audit-log")
export class AdminAuditLogController {
  constructor(private readonly auditLogs: AdminAuditLogService) {}

  /** Up to 50 rows newest first, filtered by adminId, resource, action, from and to; `cursor` for the next page. */
  @Get()
  @Access({ auth: ["staff"], permissions: ["audit:read"] })
  async list(@Query() query: unknown, @Req() req: AdminRequest): Promise<AuditLogPage> {
    const parsed = AuditLogQueryDto.safeParse(query);
    if (!parsed.success) throw new BadRequestException(parsed.error.flatten());
    const { cursor, ...filters } = parsed.data;
    return this.auditLogs.listPage(req.admin, filters, cursor);
  }

  /**
   * Every row matching the same filters, as CSV, streamed in batches. The export is recorded as an audit
   * row (PRD 09 F16) by RX-97's hook (`@AdminAudit`): it runs this handler in a transaction and writes the
   * row there before the response is sent. The handler reads no audit row: it records the filters and
   * returns the stream, which starts reading after the row is committed, outside the transaction (none is
   * held open across the stream). A GET has no write of its own, so the hook's transaction holds the row
   * alone. If the row cannot be written the request fails with 500 and nothing is streamed.
   */
  @Get("export")
  @Access({ auth: ["staff"], permissions: ["audit:read"] })
  @AdminAudit({ resource: "audit_log", action: "export" })
  @Header("Cache-Control", "no-store")
  async export(@Query() query: unknown, @Req() req: AuditedAdminRequest): Promise<StreamableFile> {
    const parsed = AuditLogExportQueryDto.safeParse(query);
    if (!parsed.success) throw new BadRequestException(parsed.error.flatten());
    const { change, csv } = await this.auditLogs.prepareExport(req.admin, parsed.data);
    req.audit.record(change);
    return new StreamableFile(Readable.from(csv), {
      type: "text/csv; charset=utf-8",
      disposition: 'attachment; filename="audit-log.csv"',
    });
  }
}
