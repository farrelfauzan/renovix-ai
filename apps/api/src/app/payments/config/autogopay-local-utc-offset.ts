import { JAKARTA_UTC_OFFSET_MS } from "./jakarta-utc-offset";

/**
 * The offset of AutoGoPay's date-times that carry none (`YYYY-MM-DD HH:mm:ss`, e.g. `expiry_time`, `paid_at`; RNX-273).
 * AutoGoPay's date-times have no offset; taken as WIB (UTC+7, the Jakarta offset) (D285), confirm in the pilot.
 */
export const AUTOGOPAY_LOCAL_UTC_OFFSET_MS = JAKARTA_UTC_OFFSET_MS;
