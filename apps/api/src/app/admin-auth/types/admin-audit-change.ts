import type { AdminAuditValues } from "./admin-audit-values";

/** What an audited back-office route changed (RX-97), recorded by its handler through `request.audit.record`. */
export type AdminAuditChange = {
  readonly before: AdminAuditValues;
  readonly after: AdminAuditValues;
  /** The reason the admin typed; "" (the default) when the route asks for none. */
  readonly reason?: string;
  /** When the change takes effect; now (the default) for an immediate change. */
  readonly effectiveAt?: Date;
};
