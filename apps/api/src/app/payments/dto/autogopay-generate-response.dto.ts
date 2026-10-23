import { z } from "zod";

/**
 * The fields the adapter reads from AutoGoPay's `/qris/generate` answer (RNX-229, R-20 section 3.1). Other documented
 * fields (order_id, amount, transaction_status, qr_url, transaction_time) are not read. `checkout_url` is read but not
 * surfaced: CreatedCharge carries only the QR string.
 * Shape assumed from R-20 section 3.1 (fields at the top level, not wrapped; expiry_time an ISO 8601 date-time with
 * an offset); confirm against the live API (RNX-229 DoD pilot).
 */
export const AutoGoPayGenerateResponseDto = z.object({
  transaction_id: z.string().min(1),
  qr_string: z.string().min(1),
  checkout_url: z.string().optional(),
  expiry_time: z.iso.datetime({ offset: true }),
});
export type AutoGoPayGenerateResponseDto = z.infer<typeof AutoGoPayGenerateResponseDto>;
