import { Injectable } from "@nestjs/common";
import type { Prisma } from "@generated/prisma/client.js";
import type { DbTransaction } from "../../prisma/db-transaction";
import { PrismaService } from "../../prisma/prisma.service";

/** The queries on `ai_models` (RX-21 price refresh). Model reads for the registry stay in ModelRegistryService. */
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
}
