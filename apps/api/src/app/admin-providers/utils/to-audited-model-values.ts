import type { AdminAuditValues } from "../../admin-auth/types/admin-audit-values";
import type { ProviderModelView } from "../types/provider-model-view";

/** The model fields an audit row shows (RX-177). */
export const toAuditedModelValues = (model: ProviderModelView): AdminAuditValues => ({
  slug: model.slug,
  modelName: model.modelName,
  tier: model.tier,
  inputPrice: model.inputPrice,
  outputPrice: model.outputPrice,
  cachedInputPrice: model.cachedInputPrice,
  maxTokens: model.maxTokens,
  maxOutputTokens: model.maxOutputTokens,
  active: model.active,
  fallbackModelIds: model.fallbackModelIds.join(","),
});
