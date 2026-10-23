import { z } from "zod";

/**
 * The fields the adapter reads from AutoGoPay's webhook body (RNX-229, RNX-273: the official docs' payload `event,
 * timestamp, transaction { transaction_id, order_id, amount, status: PAID, payment_method, paid_at }`, not wrapped in
 * the answer envelope). Read only after the signature over the raw bytes is verified. A missing or null
 * `payment_method` is taken as QRIS (the docs always send it; #167 review NIT).
 */
export const AutoGoPayWebhookBodyDto = z.object({
  transaction: z.object({
    transaction_id: z.string().min(1),
    status: z.string(),
    amount: z.int().nonnegative().nullish(),
    payment_method: z.string().nullish(),
  }),
});
export type AutoGoPayWebhookBodyDto = z.infer<typeof AutoGoPayWebhookBodyDto>;
