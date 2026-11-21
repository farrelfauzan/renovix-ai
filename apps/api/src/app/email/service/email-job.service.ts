import { Injectable } from "@nestjs/common";
import { PrismaService } from "../../prisma/prisma.service";

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
   * Claims up to `limit` due pending jobs, oldest first, and marks them "sending". RNX-338: the claim is one statement
   * that skips rows another API container is claiming (FOR UPDATE SKIP LOCKED), so a job goes to exactly one container.
   */
  async claimPendingJobs(limit = 10) {
    const now = new Date();

    const claimed = await this.prisma.$queryRaw<{ id: string }[]>`
      UPDATE "email_jobs" SET "status" = 'sending', "updatedAt" = ${now}
      WHERE "id" IN (
        SELECT "id" FROM "email_jobs"
        WHERE "status" = 'pending' AND "next_attempt_at" <= ${now}
        ORDER BY "createdAt" ASC LIMIT ${limit} FOR UPDATE SKIP LOCKED)
      RETURNING "id"`;

    if (claimed.length === 0) return [];

    return this.prisma.emailJob.findMany({
      where: { id: { in: claimed.map((job) => job.id) } },
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
      },
    });
  }

  async markFailed(jobId: string, error: string, retryable: boolean) {
    const job = await this.prisma.emailJob.findUniqueOrThrow({
      where: { id: jobId },
    });

    const attempts = job.attempts + 1;
    const maxAttempts = 3;

    if (retryable && attempts < maxAttempts) {
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
        },
      });
    } else {
      await this.prisma.emailJob.update({
        where: { id: jobId },
        data: {
          status: "failed",
          attempts,
          lastError: error,
        },
      });
    }
  }
}
