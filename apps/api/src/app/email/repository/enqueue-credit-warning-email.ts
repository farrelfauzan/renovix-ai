import type { EmailJob } from "@generated/prisma/client.js";
import type { DbTransaction } from "../../prisma/db-transaction";
import { CREDIT_WARNING_EMAIL } from "../config/credit-warning-email";
import type { CreditWarningEmailPayload } from "../types/credit-warning-email-payload";

/**
 * RNX-329: queues a run-out warning mail to the account owner, on the transaction that records the warning, so a warning
 * is never recorded without its mail. The queue sends it outside any request (EmailScheduler).
 */
export function enqueueCreditWarningEmail(
  db: DbTransaction,
  { recipientEmail, payload }: { readonly recipientEmail: string; readonly payload: CreditWarningEmailPayload },
): Promise<EmailJob> {
  return db.emailJob.create({
    data: { type: CREDIT_WARNING_EMAIL, recipientEmail, payload, status: "pending", nextAttemptAt: new Date() },
  });
}
