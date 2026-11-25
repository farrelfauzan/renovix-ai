import { PERSONAL_DATA_MASK } from "../../admin-auth/config/personal-data-mask";

/**
 * A user's personal field as the back office shows it (RNX-357): the whole value replaced by the mask (no part kept),
 * or null when the user has not set it.
 */
export const maskUserField = (value: string | null): string | null => (value === null ? null : PERSONAL_DATA_MASK);
