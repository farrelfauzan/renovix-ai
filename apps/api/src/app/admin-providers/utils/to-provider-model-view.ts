import type { ProviderModelRecord } from "../types/provider-model-record";
import type { ProviderModelView } from "../types/provider-model-view";

/** The response shape of a model on a provider record (RX-177); decimal prices as strings. */
export function toProviderModelView(record: ProviderModelRecord, providerRecordId: string): ProviderModelView {
  return {
    id: record.id,
    providerRecordId,
    slug: record.slug,
    modelName: record.modelName,
    tier: record.tier,
    inputPrice: record.inputPrice.toFixed(),
    outputPrice: record.outputPrice.toFixed(),
    cachedInputPrice: record.cachedInputPrice?.toFixed() ?? null,
    maxTokens: record.maxTokens,
    maxOutputTokens: record.maxOutputTokens,
    active: record.active,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
}
