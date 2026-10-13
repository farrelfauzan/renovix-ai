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

  async claimPendingJobs(limit = 10) {
    const now = new Date();

    const jobs = await this.prisma.emailJob.findMany({
      where: {
        status: "pending",
        nextAttemptAt: { lte: now },
      },
      orderBy: { createdAt: "asc" },
      take: limit,
    });

    if (jobs.length === 0) return [];

    // Mark as sending
    await this.prisma.emailJob.updateMany({
      where: { id: { in: jobs.map((j) => j.id) } },
      data: { status: "sending" },
    });

    return jobs;
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
