import { z } from "zod";
import { MODEL_TIERS } from "../../offers/config/model-tiers";
import { ModelPriceDto } from "./model-price.dto";
import { ModelSlugDto } from "./model-slug.dto";

const MAX_MODEL_NAME_LENGTH = 200;

/**
 * POST /admin/providers/:id/models (RX-177). `slug` is the provider's own model id (D149 option B), unique
 * across all providers and never changed; `tier` is one of MODEL_TIERS; `active` has no default.
 */
export const CreateProviderModelDto = z.strictObject({
  slug: ModelSlugDto,
  modelName: z.string().trim().min(1).max(MAX_MODEL_NAME_LENGTH),
  tier: z.enum(MODEL_TIERS),
  inputPrice: ModelPriceDto,
  outputPrice: ModelPriceDto,
  cachedInputPrice: ModelPriceDto.nullable().optional(),
  maxTokens: z.number().int().positive(),
  maxOutputTokens: z.number().int().positive().nullable().optional(),
  active: z.boolean(),
});
export type CreateProviderModelDto = z.infer<typeof CreateProviderModelDto>;
