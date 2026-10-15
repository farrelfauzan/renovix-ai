import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { from, lastValueFrom, Observable } from "rxjs";
import type { DbTransaction } from "../../prisma/db-transaction";
import { TransactionService } from "../../prisma/transaction.service";
import { AdminAudit } from "../decorator/admin-audit.decorator";
import { AdminAuditLogRepository } from "../repository/admin-audit-log.repository";
import type { AdminAuditChange } from "../types/admin-audit-change";
import type { AuditedAdminRequest } from "../types/audited-admin-request";

/**
 * The one write hook of the back office (RX-97, D57), registered globally (APP_INTERCEPTOR). On a route
 * that declares `@AdminAudit({ resource, action })` it opens one database transaction, runs the handler in
 * it with `request.audit` (the transaction and `record`), then writes the audit row in the same
 * transaction: the admin's write and its audit row commit together. If the row cannot be written, or the
 * handler recorded no change, the transaction rolls back and the request fails. Any other route (no
 * declaration, or exempt) passes through untouched. The request id is Fastify's `request.id`.
 */
@Injectable()
export class AdminAuditInterceptor implements NestInterceptor {
  constructor(
    private readonly reflector: Reflector,
    private readonly auditLog: AdminAuditLogRepository,
    private readonly transactions: TransactionService,
  ) {}

  /** Runs an audited route inside its audit transaction; passes any other route through. */
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const audit = this.reflector.getAllAndOverride(AdminAudit, [context.getHandler(), context.getClass()]);
    if (!audit || audit.exempt) return next.handle();
    const request = context.switchToHttp().getRequest<AuditedAdminRequest>();
    return from(this.transactions.run((tx) => this.runAudited(request, { resource: audit.resource, action: audit.action }, next, tx)));
  }

  private async runAudited(
    request: AuditedAdminRequest,
    target: { readonly resource: string; readonly action: string },
    next: CallHandler,
    tx: DbTransaction,
  ): Promise<unknown> {
    const recorded: { change?: AdminAuditChange } = {};
    request.audit = { tx, record: (change) => (recorded.change = change) };
    const result = await lastValueFrom(next.handle(), { defaultValue: undefined });
    const { change } = recorded;
    if (!change) throw new Error(`Audited route ${target.resource}/${target.action} recorded no change`);
    await this.auditLog.create(
      {
        adminId: request.admin.adminId,
        ...target,
        before: change.before,
        after: change.after,
        reason: change.reason ?? "",
        requestId: request.id,
        effectiveAt: change.effectiveAt ?? new Date(),
      },
      tx,
    );
    return result;
  }
}
