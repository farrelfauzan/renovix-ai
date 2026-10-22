import { z } from "zod";

const MAX_REASON_LENGTH = 500;

/** POST /admin/payments/orders/:id/confirm (RNX-35, AC20): why the admin asks the provider again (audited). */
export const ConfirmOrderBodyDto = z.strictObject({ reason: z.string().trim().min(1).max(MAX_REASON_LENGTH) });
export type ConfirmOrderBodyDto = z.infer<typeof ConfirmOrderBodyDto>;
