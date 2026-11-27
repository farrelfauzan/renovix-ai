import { z } from "zod";

/** Longest reason an admin may give for an audited action. */
const MAX_REASON_LENGTH = 500;

/** The reason an admin gives for an audited action (an admin write or a personal-data reveal): required, 1 to 500 characters after trimming. */
export const AuditReasonDto = z.string().trim().min(1).max(MAX_REASON_LENGTH);
export type AuditReasonDto = z.infer<typeof AuditReasonDto>;
