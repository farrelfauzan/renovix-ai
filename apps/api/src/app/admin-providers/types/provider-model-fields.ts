/** The writable columns of a model on a provider record (RX-177); prices as decimal strings. */
export type ProviderModelFields = {
  readonly modelName?: string;
  readonly tier?: string;
  readonly inputPrice?: string;
  readonly outputPrice?: string;
  readonly cachedInputPrice?: string | null;
  readonly maxTokens?: number;
  readonly maxOutputTokens?: number | null;
  readonly active?: boolean;
};
