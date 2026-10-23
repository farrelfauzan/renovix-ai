import { JAKARTA_UTC_OFFSET_MS } from "../config/jakarta-utc-offset";

/** The Asia/Jakarta calendar day of `at`, as "YYYY-MM-DD" (RNX-35). */
export const toJakartaDay = (at: Date): string => new Date(at.getTime() + JAKARTA_UTC_OFFSET_MS).toISOString().slice(0, 10);
