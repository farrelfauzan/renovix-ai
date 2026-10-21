/** RNX-179: a new ordered list of fallback models for one model, checked against the model's tier after the change. */
export type ModelFallbacksChange = {
  readonly modelId: string;
  readonly tier: string;
  readonly fallbackModelIds: readonly string[];
};
