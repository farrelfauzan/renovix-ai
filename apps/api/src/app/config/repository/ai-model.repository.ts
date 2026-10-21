import { ConflictException, Injectable } from "@nestjs/common";
import { Prisma } from "@generated/prisma/client.js";
import type { NewProviderModel } from "../../admin-providers/types/new-provider-model";
import type { ProviderModelFields } from "../../admin-providers/types/provider-model-fields";
import type { ProviderModelRecord } from "../../admin-providers/types/provider-model-record";
import type { DbTransaction } from "../../prisma/db-transaction";
import { PrismaService } from "../../prisma/prisma.service";

/** RX-177: the columns the admin model routes read (never provider or provider_id, D149 option B). */
const PROVIDER_MODEL_FIELDS = {
  id: true,
  slug: true,
  modelName: true,
  tier: true,
  inputPrice: true,
  outputPrice: true,
  cachedInputPrice: true,
  maxTokens: true,
  maxOutputTokens: true,
  active: true,
  createdAt: true,
  updatedAt: true,
  fallbacks: { select: { fallbackModelId: true }, orderBy: { position: "asc" } },
} as const;
const SLUG_TAKEN = "A model with this slug already exists";

/** The queries on `ai_models` (RX-21 price refresh; RX-177 models of a provider record). Model reads for the registry stay in ModelRegistryService. */
@Injectable()
export class AiModelRepository {
  constructor(private readonly prisma: PrismaService) {}

  /** Every model of `provider`, active or not, with its provider id and prices. */
  findByProvider(provider: string, tx?: DbTransaction) {
    return (tx ?? this.prisma).aiModel.findMany({ where: { provider } });
  }

  /** Updates one model's provider prices and stamps price_updated_at; the transaction is required because it writes. */
  updatePrices(
    modelId: string,
    prices: {
      inputPrice: Prisma.Decimal;
      outputPrice: Prisma.Decimal;
      cachedInputPrice: Prisma.Decimal | null;
    },
    tx: DbTransaction,
  ) {
    return tx.aiModel.update({
      where: { id: modelId },
      data: { ...prices, priceUpdatedAt: new Date() },
    });
  }

  /** RX-177: every model of a provider record, active or not, oldest first. */
  findByProviderRecord(providerRecordId: string, tx?: DbTransaction): Promise<ProviderModelRecord[]> {
    return (tx ?? this.prisma).aiModel.findMany({
      where: { providerRecordId },
      select: PROVIDER_MODEL_FIELDS,
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    });
  }

  /** RX-177: one model of a provider record; null when it does not exist or belongs to another provider. */
  findOnProviderRecord(id: string, providerRecordId: string, tx?: DbTransaction): Promise<ProviderModelRecord | null> {
    return (tx ?? this.prisma).aiModel.findFirst({ where: { id, providerRecordId }, select: PROVIDER_MODEL_FIELDS });
  }

  /** RX-177: how many active models a provider record has. */
  countActiveOnProviderRecord(providerRecordId: string, tx?: DbTransaction): Promise<number> {
    return (tx ?? this.prisma).aiModel.count({ where: { providerRecordId, active: true } });
  }

  /** RX-177: creates a model on a provider record; a slug taken on any provider is a 409. provider_id keeps its default (''). */
  createOnProviderRecord(providerRecordId: string, model: NewProviderModel, tx?: DbTransaction): Promise<ProviderModelRecord> {
    const data = { ...model, providerRecordId };
    return this.refuseTakenSlug(() => (tx ?? this.prisma).aiModel.create({ data, select: PROVIDER_MODEL_FIELDS }));
  }

  /** RX-177: changes a model of a provider record (never its slug). */
  updateOnProviderRecord(id: string, providerRecordId: string, fields: ProviderModelFields, tx?: DbTransaction): Promise<ProviderModelRecord> {
    return (tx ?? this.prisma).aiModel.update({ where: { id, providerRecordId }, data: fields, select: PROVIDER_MODEL_FIELDS });
  }

  /** RNX-179: the id and tier of each of these models that exists, on any provider, active or not. */
  findTiers(ids: readonly string[], tx?: DbTransaction): Promise<{ id: string; tier: string }[]> {
    return (tx ?? this.prisma).aiModel.findMany({ where: { id: { in: [...ids] } }, select: { id: true, tier: true } });
  }

  /** RNX-179: replaces a model's fallback models with these, in this order (position 0 first). */
  async replaceFallbacks(modelId: string, fallbackModelIds: readonly string[], tx: DbTransaction): Promise<void> {
    await tx.aiModelFallback.deleteMany({ where: { modelId } });
    await tx.aiModelFallback.createMany({
      data: fallbackModelIds.map((fallbackModelId, position) => ({ modelId, fallbackModelId, position })),
    });
  }

  /** Runs a write; the unique slug (P2002) becomes a 409. */
  private async refuseTakenSlug<T>(write: () => Promise<T>): Promise<T> {
    try {
      return await write();
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") throw new ConflictException(SLUG_TAKEN);
      throw err;
    }
  }
}
