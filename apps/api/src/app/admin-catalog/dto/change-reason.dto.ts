import { z } from "zod";

const MAX_REASON_LENGTH = 500;

/** Why an admin makes a catalog or settings change (RNX-226): written onto its change record and its audit row. */
export const ChangeReasonDto = z.string().trim().min(1).max(MAX_REASON_LENGTH);
export type ChangeReasonDto = z.infer<typeof ChangeReasonDto>;
