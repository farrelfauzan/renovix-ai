import { z } from "zod";

/**
 * The fields the adapter reads from `data` in AutoGoPay's `/qris/generate` answer (RNX-229, RNX-273: the official docs'
 * example). Other documented fields (order_id, amount, transaction_status, qr_url, transaction_time) are not read.
 * `checkout_url` is read but not surfaced: CreatedCharge carries only the QR string. `expiry_time` is
 * `YYYY-MM-DD HH:mm:ss` without an offset (read as WIB, D285) and is parsed by the adapter.
 */
export const AutoGoPayGenerateResponseDto = z.object({
  transaction_id: z.string().min(1),
  qr_string: z.string().min(1),
  checkout_url: z.string().optional(),
  expiry_time: z.string(),
});
export type AutoGoPayGenerateResponseDto = z.infer<typeof AutoGoPayGenerateResponseDto>;
