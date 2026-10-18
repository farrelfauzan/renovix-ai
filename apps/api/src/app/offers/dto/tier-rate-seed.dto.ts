import { z } from "zod";
import { MODEL_TIERS } from "../config/model-tiers";

/**
 * The tier-rate seed file (prisma/tier-rates.seed.json) that the Tech Lead edits (RX-21). Each entry is
 * a tier's credit rates exactly as docs/credits.md defines them: CREDITS PER 1,000,000 TOKENS of one
 * kind (section 1: "a tier rate is an absolute number of credits per 1,000,000 tokens of one token
 * kind"). Values come only from the file; no rate is written in code. The cost helpers divide the
 * token-weighted sum by 1,000,000 (section 1.3's formula), so these numbers are stored verbatim.
 */
export const TierRateSeedDto = z.strictObject({
  notes: z.array(z.string()).optional(),
  reason: z.string().min(1),
  rates: z
    .array(
      z.strictObject({
        tier: z.enum(MODEL_TIERS),
        input: z.number().nonnegative(),
        cached: z.number().nonnegative(),
        output: z.number().nonnegative(),
      }),
    )
    .min(1),
});
export type TierRateSeedDto = z.infer<typeof TierRateSeedDto>;
