import type { CreditEstimateSchema } from "../dto/credit-estimate.dto";
import type { z } from "zod";

/** RNX-331: what the estimate needs: the session's user (never a request field) and the validated body. */
export type CreditEstimateInput = z.infer<typeof CreditEstimateSchema> & {
  readonly userId: string;
};
