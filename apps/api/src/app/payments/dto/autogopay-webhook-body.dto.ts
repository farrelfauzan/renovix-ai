import { z } from "zod";

/**
 * The fields the adapter reads from AutoGoPay's webhook body (RNX-229, R-20 section 3.1: `event, timestamp,
 * transaction { transaction_id, order_id, amount, status: PAID, payment_method, paid_at }`). Read only after the
 * signature over the raw bytes is verified. Shape assumed from R-20 section 3.1 (`amount` a whole-rupiah number);
 * confirm against the live API (RNX-229 DoD pilot).
 */
export const AutoGoPayWebhookBodyDto = z.object({
  transaction: z.object({
    transaction_id: z.string().min(1),
    status: z.string(),
    amount: z.int().nonnegative().nullish(),
  }),
});
export type AutoGoPayWebhookBodyDto = z.infer<typeof AutoGoPayWebhookBodyDto>;
