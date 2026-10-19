import { PROVIDER_TYPE_NAMES } from "../config/provider-type-names";
import type { ProviderRecord } from "../types/provider-record";
import type { ProviderView } from "../types/provider-view";

/** The response shape of a provider (RX-177): the key is write-only, so only `hasApiKey` and its hint. */
export function toProviderView(record: ProviderRecord): ProviderView {
  return {
    id: record.id,
    type: PROVIDER_TYPE_NAMES[record.type],
    name: record.name,
    baseUrl: record.baseUrl,
    status: record.status,
    hasApiKey: record.apiKeyHint.length > 0,
    apiKeyHint: record.apiKeyHint,
    lastTestedAt: record.lastTestedAt,
    lastTestResult: record.lastTestResult,
    modelCount: record._count.models,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
}
