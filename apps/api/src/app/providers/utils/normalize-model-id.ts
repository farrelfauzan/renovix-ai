/**
 * A model id compared in its dashed form (RX-178): lower case, every "." as "-". A provider that writes
 * "x/model-5-5" and one that writes "model-5.5" then name the same model.
 */
export const normalizeModelId = (modelId: string): string => modelId.toLowerCase().replace(/\./g, "-");
