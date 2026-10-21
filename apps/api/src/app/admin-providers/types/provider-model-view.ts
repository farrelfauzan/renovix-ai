/** A model as the /admin/providers/:id/models routes return it (RX-177); prices in USD per token as decimal strings. */
export type ProviderModelView = {
  readonly id: string;
  /** The provider record the model belongs to. */
  readonly providerRecordId: string;
  readonly slug: string;
  readonly modelName: string;
  readonly tier: string;
  readonly inputPrice: string;
  readonly outputPrice: string;
  readonly cachedInputPrice: string | null;
  readonly maxTokens: number;
  readonly maxOutputTokens: number | null;
  readonly active: boolean;
  readonly createdAt: Date;
  readonly updatedAt: Date;
  /** RNX-179: the ids of the model's fallback models, in order. */
  readonly fallbackModelIds: readonly string[];
};
