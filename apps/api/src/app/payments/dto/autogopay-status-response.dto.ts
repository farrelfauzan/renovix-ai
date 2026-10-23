import { z } from "zod";

/**
 * The fields the adapter reads from AutoGoPay's `/qris/status` answer (RNX-229, R-20 section 3.1: pending, settlement,
 * expire or cancel). Shape assumed from R-20 section 3.1 (the status in `transaction_status` as in /qris/generate, a
 * whole-rupiah `amount`, `paid_at` as in the webhook; none documented for this endpoint); confirm against the live API
 * (RNX-229 DoD pilot).
 */
export const AutoGoPayStatusResponseDto = z.object({
  transaction_status: z.string(),
  amount: z.int().nonnegative().nullish(),
  paid_at: z.string().nullish(),
});
export type AutoGoPayStatusResponseDto = z.infer<typeof AutoGoPayStatusResponseDto>;
