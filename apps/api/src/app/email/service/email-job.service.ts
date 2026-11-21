import { Injectable } from "@nestjs/common";
import { PrismaService } from "../../prisma/prisma.service";
import { EMAIL_JOB_CLAIM_LEASE_MS } from "../config/email-job-claim-lease-ms";
import { EMAIL_JOB_MAX_ATTEMPTS } from "../config/email-job-max-attempts";

interface EnqueueParams {
  type: string;
  recipientEmail: string;
  payload: Record<string, unknown>;
}

@Injectable()
export class EmailJobService {
  constructor(private readonly prisma: PrismaService) {}

  async enqueue(params: EnqueueParams) {
    const now = new Date();

    return this.prisma.emailJob.create({
      data: {
        type: params.type,
        recipientEmail: params.recipientEmail,
        payload: params.payload as any,
        status: "pending",
        nextAttemptAt: now,
      },
    });
  }

  /**
   * Claims up to `limit` jobs, oldest first, marks them "sending" with a lease until now + EMAIL_JOB_CLAIM_LEASE_MS and
   * returns them. RNX-338: the claim is one statement that skips rows another API container is claiming (FOR UPDATE SKIP
   * LOCKED), so a job goes to exactly one container. It takes due pending jobs and, RNX-352, "sending" jobs whose lease
   * has ended (a "sending" job without a lease, claimed before RNX-352, counts as leased from its updatedAt). Taking a
   * "sending" job again counts the lost try as an attempt; a job that has then used EMAIL_JOB_MAX_ATTEMPTS is "failed"
   * with "claim lease expired", in the same statement, and is not returned.
   */
  async claimPendingJobs(limit = 10) {
    const now = new Date();
    const claimedUntil = new Date(now.getTime() + EMAIL_JOB_CLAIM_LEASE_MS);
    const unleasedClaimExpiredBefore = new Date(now.getTime() - EMAIL_JOB_CLAIM_LEASE_MS);

    const claimed = await this.prisma.$queryRaw<{ id: string; status: string }[]>`
      UPDATE "email_jobs" SET
        "status" = CASE WHEN "status" = 'sending' AND "attempts" + 1 >= ${EMAIL_JOB_MAX_ATTEMPTS} THEN 'failed' ELSE 'sending' END,
        "last_error" = CASE WHEN "status" = 'sending' AND "attempts" + 1 >= ${EMAIL_JOB_MAX_ATTEMPTS} THEN 'claim lease expired' ELSE "last_error" END,
        "claimed_until" = CASE WHEN "status" = 'sending' AND "attempts" + 1 >= ${EMAIL_JOB_MAX_ATTEMPTS} THEN NULL ELSE ${claimedUntil}::timestamptz END,
        "attempts" = CASE WHEN "status" = 'sending' THEN "attempts" + 1 ELSE "attempts" END,
        "updatedAt" = ${now}
      WHERE "id" IN (
        SELECT "id" FROM "email_jobs"
        WHERE ("status" = 'pending' AND "next_attempt_at" <= ${now})
          OR ("status" = 'sending' AND ("claimed_until" < ${now} OR ("claimed_until" IS NULL AND "updatedAt" < ${unleasedClaimExpiredBefore})))
        ORDER BY "createdAt" ASC LIMIT ${limit} FOR UPDATE SKIP LOCKED)
      RETURNING "id", "status"`;
    const sendingIds = claimed.filter((job) => job.status === "sending").map((job) => job.id);

    if (sendingIds.length === 0) return [];

    return this.prisma.emailJob.findMany({
      where: { id: { in: sendingIds } },
      orderBy: { createdAt: "asc" },
    });
  }

  async markSent(jobId: string, providerMessageId?: string) {
    await this.prisma.emailJob.update({
      where: { id: jobId },
      data: {
        status: "sent",
        sentAt: new Date(),
        provider: "ses_smtp",
        providerMessageId,
        claimedUntil: null,
      },
    });
  }

  async markFailed(jobId: string, error: string, retryable: boolean) {
    const job = await this.prisma.emailJob.findUniqueOrThrow({
      where: { id: jobId },
    });

    const attempts = job.attempts + 1;

    if (retryable && attempts < EMAIL_JOB_MAX_ATTEMPTS) {
      // Exponential backoff: 30s, 120s, 480s
      const delayMs = 30000 * Math.pow(4, attempts - 1);
      const nextAttemptAt = new Date(Date.now() + delayMs);

      await this.prisma.emailJob.update({
        where: { id: jobId },
        data: {
          status: "pending",
          attempts,
          lastError: error,
          nextAttemptAt,
          claimedUntil: null,
        },
      });
    } else {
      await this.prisma.emailJob.update({
        where: { id: jobId },
        data: {
          status: "failed",
          attempts,
          lastError: error,
          claimedUntil: null,
        },
      });
    }
  }
}
