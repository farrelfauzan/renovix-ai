import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { ModelRegistryService } from "../../config/model-registry.service";
import { isTierAbove } from "../../config/utils/is-tier-above";
import { AiModelRepository } from "../../config/repository/ai-model.repository";
import type { DbTransaction } from "../../prisma/db-transaction";
import type { CreateProviderModelDto } from "../dto/create-provider-model.dto";
import type { UpdateProviderModelDto } from "../dto/update-provider-model.dto";
import type { Audited } from "../types/audited";
import type { ModelFallbacksChange } from "../types/model-fallbacks-change";
import type { ProviderModelView } from "../types/provider-model-view";
import { buildAuditChange } from "../utils/build-audit-change";
import { toAuditedModelValues } from "../utils/to-audited-model-values";
import { toProviderModelView } from "../utils/to-provider-model-view";
import { AdminProvidersService } from "./admin-providers.service";

/**
 * The models of a provider record (RX-177, D149), under /admin/providers/:providerId/models. An unknown or
 * deleted provider is a 404, and so is a model of another provider. The slug is the provider's own model id,
 * unique across all providers and never changed; a model is deactivated, never deleted. provider and
 * provider_id are neither written nor read (D149 option B; request-time resolution is RX-178). RX-178 (D199-2): a
 * deactivation drops the model from this process's ModelRegistryService cache at once; an activation makes the
 * registry reload on its next lookup. RNX-179 (D58, D149): a PATCH may replace the model's ordered fallback models
 * (`fallbackModelIds`); the registry reloads on its next lookup.
 */
@Injectable()
export class AdminProviderModelsService {
  constructor(
    private readonly providers: AdminProvidersService,
    private readonly models: AiModelRepository,
    private readonly registry: ModelRegistryService,
  ) {}

  /** Every model of a live provider, active or not. */
  async list(providerId: string): Promise<ProviderModelView[]> {
    await this.providers.get(providerId);
    const records = await this.models.findByProviderRecord(providerId);
    return records.map((record) => toProviderModelView(record, providerId));
  }

  /** Creates a model on a live provider; a slug taken on any provider is a 409. */
  async create(providerId: string, dto: CreateProviderModelDto, tx: DbTransaction): Promise<Audited<ProviderModelView>> {
    await this.providers.get(providerId, tx);
    const model = toProviderModelView(await this.models.createOnProviderRecord(providerId, dto, tx), providerId);
    const change = buildAuditChange({ subject: { providerId, modelId: model.id }, before: {}, after: toAuditedModelValues(model) });
    return { result: model, change };
  }

  /** Changes a model of a live provider; 404 when the model belongs to another provider. */
  async update(providerId: string, modelId: string, dto: UpdateProviderModelDto, tx: DbTransaction): Promise<Audited<ProviderModelView>> {
    await this.providers.get(providerId, tx);
    const before = await this.models.findOnProviderRecord(modelId, providerId, tx);
    if (!before) throw new NotFoundException("Model not found on this provider");
    const { fallbackModelIds, ...fields } = dto;
    if (fallbackModelIds) await this.replaceFallbacks({ modelId, tier: fields.tier ?? before.tier, fallbackModelIds }, tx);
    const after = toProviderModelView(await this.models.updateOnProviderRecord(modelId, providerId, fields, tx), providerId);
    if (dto.active === false) this.registry.forgetModel(before.slug);
    if (dto.active === true || fallbackModelIds) this.registry.expireCache();
    const change = buildAuditChange({
      subject: { providerId, modelId },
      before: toAuditedModelValues(toProviderModelView(before, providerId)),
      after: toAuditedModelValues(after),
    });
    return { result: after, change };
  }

  /**
   * RNX-179 (D149): stores the model's new fallback list. 400 when it names the model itself, a model that does not
   * exist, or a model whose tier is above the model's (a fallback is in the same tier or a cheaper one).
   */
  private async replaceFallbacks({ modelId, tier, fallbackModelIds }: ModelFallbacksChange, tx: DbTransaction): Promise<void> {
    if (fallbackModelIds.includes(modelId)) throw new BadRequestException("A model cannot be its own fallback");
    const fallbacks = await this.models.findTiers(fallbackModelIds, tx);
    if (fallbacks.length !== fallbackModelIds.length) throw new BadRequestException("A fallback model does not exist");
    const above = fallbacks.find((fallback) => isTierAbove(fallback.tier, tier));
    if (above) {
      throw new BadRequestException(`A fallback model must be in the model's tier (${tier}) or a lower one; it is ${above.tier}`);
    }
    await this.models.replaceFallbacks(modelId, fallbackModelIds, tx);
  }
}
