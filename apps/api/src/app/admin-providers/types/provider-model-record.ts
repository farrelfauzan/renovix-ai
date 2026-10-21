import type { Prisma } from "@generated/prisma/client.js";

/** A model of a provider record as AiModelRepository reads it for the admin routes (RX-177). */
export type ProviderModelRecord = {
  readonly id: string;
  readonly slug: string;
  readonly modelName: string;
  readonly tier: string;
  readonly inputPrice: Prisma.Decimal;
  readonly outputPrice: Prisma.Decimal;
  readonly cachedInputPrice: Prisma.Decimal | null;
  readonly maxTokens: number;
  readonly maxOutputTokens: number | null;
  readonly active: boolean;
  readonly createdAt: Date;
  readonly updatedAt: Date;
  /** RNX-179: the model's fallback models, in order. */
  readonly fallbacks: readonly { readonly fallbackModelId: string }[];
};
