import type { EmailJob } from "@generated/prisma/client.js";
import type { DbTransaction } from "../../prisma/db-transaction";

/** The EmailJob type of the mail that confirms a new email address (RNX-78); EmailScheduler builds and sends it. */
export const EMAIL_CHANGE_VERIFICATION = "email_change_verification";

/**
 * RNX-78: queues the mail with Better Auth's confirmation link for a new email address, to that new address. A plain
 * function on any client, so the Better Auth hook in lib/auth.ts (its own PrismaClient, outside Nest DI) can use it.
 * The queue sends it outside the request (EmailScheduler); the link is stored only in the row's payload, never logged.
 */
export function enqueueEmailChangeVerification(
  db: DbTransaction,
  { recipientEmail, verifyUrl }: { readonly recipientEmail: string; readonly verifyUrl: string },
): Promise<EmailJob> {
  return db.emailJob.create({
    data: {
      type: EMAIL_CHANGE_VERIFICATION,
      recipientEmail,
      payload: { verifyUrl, recipientEmail },
      status: "pending",
      nextAttemptAt: new Date(),
    },
  });
}
