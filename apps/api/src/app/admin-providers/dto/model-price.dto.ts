import { z } from "zod";

/** A provider price in USD per token as a decimal string (ai_models: DECIMAL(18,12)), e.g. "0.000003". */
export const ModelPriceDto = z.string().regex(/^\d{1,6}(\.\d{1,12})?$/, "a price is a decimal string with at most 6 integer and 12 fraction digits");
