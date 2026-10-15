import type { ApiClient } from "@/lib/api/api-client";
import type { AuditLogFilters } from "./audit-log-filters";
import type { AuditLogPage } from "./audit-log-page";
import { buildAuditLogQuery } from "./build-audit-log-query";

/** Global prefix `/api` + version `v1` + the audit log controller (apps/api, RX-164). */
const AUDIT_LOG_PATH = "/api/v1/admin/audit-log";

/** The two audit log routes (RX-164); both need `audit:read`. */
export type AuditLogApi = {
  /** One page of rows matching the filters; `cursor` from the previous page for the next one. */
  readonly listPage: (filters: AuditLogFilters, cursor?: string | null) => Promise<AuditLogPage>;
  /** Every row matching the filters as a CSV file. */
  readonly exportCsv: (filters: AuditLogFilters) => Promise<Blob>;
};

/** The audit log routes on a back-office API client (cookies, shared refresh). Throws on any answer but 2xx. */
export function createAuditLogApi(client: ApiClient): AuditLogApi {
  const send = async (path: string): Promise<Response> => {
    const res = await client.request(path);
    if (!res.ok) throw new Error(`Audit log request failed (${res.status})`);
    return res;
  };
  return {
    listPage: async (filters, cursor) => (await send(`${AUDIT_LOG_PATH}${buildAuditLogQuery(filters, cursor)}`)).json(),
    exportCsv: async (filters) => (await send(`${AUDIT_LOG_PATH}/export${buildAuditLogQuery(filters)}`)).blob(),
  };
}
