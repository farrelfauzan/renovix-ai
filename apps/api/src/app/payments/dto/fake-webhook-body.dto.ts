import { z } from "zod";

/**
 * The fake provider's webhook body (RNX-35, tests and local development only): the reference, the state it claims and
 * the amount. Read only after the signature over the raw bytes is verified.
 */
export const FakeWebhookBodyDto = z.strictObject({
  reference: z.string().min(1),
  status: z.enum(["paid", "pending", "expired", "cancelled"]),
  amountRupiah: z.int().nonnegative().nullable(),
});
export type FakeWebhookBodyDto = z.infer<typeof FakeWebhookBodyDto>;
