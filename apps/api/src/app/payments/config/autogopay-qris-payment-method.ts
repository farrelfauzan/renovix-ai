/**
 * The webhook `payment_method` of a GoPay QRIS made by `/qris/generate` (RNX-273). Other AutoGoPay products on the same
 * key (QRIS_SHOPEEPAY, QRIS_INTERACTIVE) send their own value; their webhooks are ignored (D285).
 */
export const AUTOGOPAY_QRIS_PAYMENT_METHOD = "QRIS";
