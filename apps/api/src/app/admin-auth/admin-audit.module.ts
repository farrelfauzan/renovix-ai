import { Module } from "@nestjs/common";
import { AdminAuditInterceptor } from "./interceptor/admin-audit.interceptor";

/**
 * The back-office audit log (RX-97, D57), without routes: the write hook (`AdminAuditInterceptor`, which
 * the app and the test module register as an APP_INTERCEPTOR). The repository of `admin_audit_log` comes
 * from RepositoriesModule.
 */
@Module({
  providers: [AdminAuditInterceptor],
  exports: [AdminAuditInterceptor],
})
export class AdminAuditModule {}
