import { z } from "zod";

/**
 * The fields the adapter reads from `data` in AutoGoPay's `/qris/status` answer (RNX-229, RNX-273). The docs list the
 * values (pending, settlement, expire, cancel) but show no answer: the status is read from `transaction_status` (as in
 * /qris/generate) when present, else from `status` (as in the sibling providers' status answers); a whole-rupiah
 * `amount`; `paid_at` as in the webhook. Confirm the exact fields in the pilot.
 */
export const AutoGoPayStatusResponseDto = z.object({
  transaction_status: z.string().optional(),
  status: z.string().optional(),
  amount: z.int().nonnegative().nullish(),
  paid_at: z.string().nullish(),
});
export type AutoGoPayStatusResponseDto = z.infer<typeof AutoGoPayStatusResponseDto>;
