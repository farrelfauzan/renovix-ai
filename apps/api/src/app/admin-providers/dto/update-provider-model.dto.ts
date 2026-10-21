import { z } from "zod";
import { CreateProviderModelDto } from "./create-provider-model.dto";

/** RNX-179: the most fallback models one model may have. */
const MAX_FALLBACK_MODELS = 5;

/**
 * PATCH /admin/providers/:id/models/:modelId (RX-177): any field but `slug`, which cannot change (refused with 400).
 * RNX-179: `fallbackModelIds` replaces the model's fallback models, in order (ids of models on any provider, each once;
 * [] removes them). The service refuses the model itself and a fallback above the model's tier (400).
 */
export const UpdateProviderModelDto = CreateProviderModelDto.omit({ slug: true })
  .partial()
  .extend({
    fallbackModelIds: z
      .array(z.uuid())
      .max(MAX_FALLBACK_MODELS)
      .refine((ids) => new Set(ids).size === ids.length, "Each fallback model may appear only once")
      .optional(),
  });
export type UpdateProviderModelDto = z.infer<typeof UpdateProviderModelDto>;
