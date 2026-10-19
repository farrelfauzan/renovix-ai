import type { AdminAuditValues } from "../../admin-auth/types/admin-audit-values";
import { PROVIDER_TYPE_NAMES } from "../config/provider-type-names";
import type { ProviderRecord } from "../types/provider-record";

/** The non-secret provider fields an audit row may show (RX-177): never the key, its ciphertext or its hint. */
export const toAuditedProviderValues = (record: ProviderRecord): AdminAuditValues => ({
  type: PROVIDER_TYPE_NAMES[record.type],
  name: record.name,
  baseUrl: record.baseUrl,
  status: record.status,
});
