import { z } from "zod";

const MAX_NOTE_LENGTH = 500;

/** POST /admin/payments/unmatched/:id/refunded (RNX-35, AC20): the admin's note on how the money went back (audited). */
export const MarkRefundedBodyDto = z.strictObject({ note: z.string().trim().min(1).max(MAX_NOTE_LENGTH) });
export type MarkRefundedBodyDto = z.infer<typeof MarkRefundedBodyDto>;
