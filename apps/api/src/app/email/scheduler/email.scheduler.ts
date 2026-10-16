import { Injectable, Logger } from "@nestjs/common";
import { Cron, CronExpression } from "@nestjs/schedule";
import { EmailJobService } from "../service/email-job.service";
import { EmailService } from "../service/email.service";
import { EmailTemplateService } from "../service/email-template.service";
import { isRetryableError } from "../utils/is-retryable-error";

@Injectable()
export class EmailScheduler {
  private readonly logger = new Logger(EmailScheduler.name);
  private processing = false;

  constructor(
    private readonly emailJobService: EmailJobService,
    private readonly emailService: EmailService,
    private readonly templateService: EmailTemplateService,
  ) {}

  @Cron(CronExpression.EVERY_10_SECONDS)
  async processEmailJobs() {
    if (this.processing) return;
    this.processing = true;

    try {
      const jobs = await this.emailJobService.claimPendingJobs(5);

      for (const job of jobs) {
        try {
          const { subject, html, text } = this.buildEmail(
            job.type,
            job.payload as Record<string, unknown>,
          );

          const result = await this.emailService.send({
            to: job.recipientEmail,
            subject,
            html,
            text,
          });

          await this.emailJobService.markSent(job.id, result.messageId);
        } catch (error: any) {
          const isRetryable = isRetryableError(error);
          const errorMsg = error?.message || "Unknown error";
          this.logger.error(`Email job ${job.id} failed: ${errorMsg}`);
          await this.emailJobService.markFailed(job.id, errorMsg, isRetryable);
        }
      }
    } finally {
      this.processing = false;
    }
  }

  private buildEmail(type: string, payload: Record<string, unknown>) {
    switch (type) {
      case "workspace_invite": {
        const token = payload.token as string;
        const acceptUrl = this.templateService.getAcceptUrl(token);

        return this.templateService.buildInviteEmail({
          workspaceName: payload.workspaceName as string,
          inviterEmail: payload.inviterEmail as string,
          role: payload.role as string,
          expiresAt: payload.expiresAt as string,
          acceptUrl,
          recipientEmail: (payload.recipientEmail as string) || "",
        });
      }
      default:
        throw new Error(`Unknown email type: ${type}`);
    }
  }
}
