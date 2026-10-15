import { Reflector } from "@nestjs/core";
import type { AdminAuditOptions } from "../types/admin-audit-options";

/**
 * The audit declaration of a state-changing back-office route (RX-97, D57), on the handler or its
 * controller: `@AdminAudit({ resource: "admin_session", action: "revoke" })` makes
 * `AdminAuditInterceptor` write the audit row in the transaction of the write;
 * `@AdminAudit({ exempt: true, reason: "..." })` exempts the route. Every POST, PUT, PATCH and DELETE
 * route under /admin carries one (app.module.access.spec.ts).
 */
export const AdminAudit = Reflector.createDecorator<AdminAuditOptions>();
