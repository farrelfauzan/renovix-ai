import { Module } from "@nestjs/common";
import { AdminAuditInterceptor } from "./interceptor/admin-audit.interceptor";
import { AdminAuditLogRepository } from "./repository/admin-audit-log.repository";

/**
 * The back-office audit log (RX-97, D57), without routes: the write hook (`AdminAuditInterceptor`, which
 * the app and the test module register as an APP_INTERCEPTOR) and the repository of `admin_audit_log`
 * (PiiRevealService writes reveal rows with it).
 */
@Module({
  providers: [AdminAuditLogRepository, AdminAuditInterceptor],
  exports: [AdminAuditLogRepository, AdminAuditInterceptor],
})
export class AdminAuditModule {}
