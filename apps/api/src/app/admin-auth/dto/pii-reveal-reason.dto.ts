import { z } from "zod";

/** Longest reason an admin may give for a personal-data reveal. */
const MAX_REASON_LENGTH = 500;

/** Why an admin reveals a user's personal data (D56, RX-97): required, 1 to 500 characters after trimming. */
export const PiiRevealReasonDto = z.string().trim().min(1).max(MAX_REASON_LENGTH);
export type PiiRevealReasonDto = z.infer<typeof PiiRevealReasonDto>;
