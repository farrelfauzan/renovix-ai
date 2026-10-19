import { Injectable, NotFoundException } from "@nestjs/common";
import { AiModelRepository } from "../../config/repository/ai-model.repository";
import type { DbTransaction } from "../../prisma/db-transaction";
import type { CreateProviderModelDto } from "../dto/create-provider-model.dto";
import type { UpdateProviderModelDto } from "../dto/update-provider-model.dto";
import type { Audited } from "../types/audited";
import type { ProviderModelView } from "../types/provider-model-view";
import { buildAuditChange } from "../utils/build-audit-change";
import { toAuditedModelValues } from "../utils/to-audited-model-values";
import { toProviderModelView } from "../utils/to-provider-model-view";
import { AdminProvidersService } from "./admin-providers.service";

/**
 * The models of a provider record (RX-177, D149), under /admin/providers/:providerId/models. An unknown or
 * deleted provider is a 404, and so is a model of another provider. The slug is the provider's own model id,
 * unique across all providers and never changed; a model is deactivated, never deleted. provider and
 * provider_id are neither written nor read (D149 option B; request-time resolution is RX-178).
 */
@Injectable()
export class AdminProviderModelsService {
  constructor(
    private readonly providers: AdminProvidersService,
    private readonly models: AiModelRepository,
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
    const after = toProviderModelView(await this.models.updateOnProviderRecord(modelId, providerId, dto, tx), providerId);
    const change = buildAuditChange({
      subject: { providerId, modelId },
      before: toAuditedModelValues(toProviderModelView(before, providerId)),
      after: toAuditedModelValues(after),
    });
    return { result: after, change };
  }
}
