import { z } from "zod";

const MAX_ID_LENGTH = 64;
const MAX_REASON_LENGTH = 500;
const MAX_REFERENCE_LENGTH = 200;
const MAX_IDEMPOTENCY_KEY_LENGTH = 200;
/** Credits as a decimal string: up to 12 integer digits and 6 decimals (whole micro-credits, a Decimal(18, 6) column). */
const CREDIT_AMOUNT_PATTERN = /^(0|[1-9]\d{0,11})(\.\d{1,6})?$/;
const ID = z.string().trim().min(1).max(MAX_ID_LENGTH);
const REFERENCE = z.string().trim().min(1).max(MAX_REFERENCE_LENGTH);

/**
 * POST /admin/credits/adjustments (RNX-227): the paid wallet of one user or one company, a positive amount of
 * credits as a decimal string (e.g. "12.5", at most 6 decimals; never a JSON number, so no float rounding), the
 * direction, the admin's reason, optional ticket and payment references, and the caller's idempotency key.
 */
export const CreditAdjustmentDto = z.strictObject({
  target: z.union([z.strictObject({ userId: ID }), z.strictObject({ companyId: ID })]),
  amount: z
    .string()
    .regex(CREDIT_AMOUNT_PATTERN)
    .refine((value) => /[1-9]/.test(value), "The amount must be above 0"),
  direction: z.enum(["add", "remove"]),
  reason: z.string().trim().min(1).max(MAX_REASON_LENGTH),
  ticketReference: REFERENCE.optional(),
  paymentReference: REFERENCE.optional(),
  idempotencyKey: z.string().min(1).max(MAX_IDEMPOTENCY_KEY_LENGTH),
});
export type CreditAdjustmentDto = z.infer<typeof CreditAdjustmentDto>;
