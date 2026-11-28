import { ConfigService } from "@nestjs/config";
import { EmailScheduler } from "./email.scheduler";
import { EmailJobService } from "../service/email-job.service";
import { EmailService } from "../service/email.service";
import { EmailTemplateService } from "../service/email-template.service";

const INVITEE_EMAIL = "invitee@example.com";
const TOKEN_MADE_UP = "token-made-up";
const EXPIRES_AT_ISO = "2030-01-15T00:00:00.000Z";

interface EmailJobRow {
  readonly id: string;
  readonly type: string;
  readonly recipientEmail: string;
  readonly payload: Record<string, unknown>;
}

interface BuiltMail {
  readonly to: string;
  readonly html: string;
  readonly text: string;
}

function buildTemplateService(): EmailTemplateService {
  const emptyConfig = { get: (_key: string, fallback?: unknown) => fallback } as unknown as ConfigService;
  return new EmailTemplateService(emptyConfig);
}

async function processJobAndCaptureMail(inputJob: EmailJobRow): Promise<BuiltMail> {
  const mockClaimPendingJobs = jest.fn().mockResolvedValue([inputJob]);
  const mockMarkSent = jest.fn().mockResolvedValue(undefined);
  const mockMarkFailed = jest.fn().mockResolvedValue(undefined);
  const mockSend = jest.fn().mockResolvedValue({ messageId: "message-made-up" });
  const fakeJobService = {
    claimPendingJobs: mockClaimPendingJobs,
    markSent: mockMarkSent,
    markFailed: mockMarkFailed,
  } as unknown as EmailJobService;
  const fakeEmailService = { send: mockSend } as unknown as EmailService;
  const scheduler = new EmailScheduler(fakeJobService, fakeEmailService, buildTemplateService());

  await scheduler.processEmailJobs();

  expect(mockMarkFailed).not.toHaveBeenCalled();
  const actualSendArgs = mockSend.mock.calls[0][0] as BuiltMail;
  return actualSendArgs;
}

describe("RNX-343: workspace invite mail names the invitee", () => {
  it("names the job recipient in the HTML and text for a job queued by create", async () => {
    const inputJob: EmailJobRow = {
      id: "job-create-made-up",
      type: "workspace_invite",
      recipientEmail: INVITEE_EMAIL,
      payload: {
        inviteId: "invite-made-up",
        token: TOKEN_MADE_UP,
        workspaceName: "Workspace Made Up",
        inviterEmail: "inviter@example.com",
        role: "member",
        expiresAt: EXPIRES_AT_ISO,
      },
    };

    const actualMail = await processJobAndCaptureMail(inputJob);

    expect(actualMail.to).toBe(INVITEE_EMAIL);
    expect(actualMail.html).toContain(`This invite was sent to ${INVITEE_EMAIL}.`);
    expect(actualMail.text).toContain(`You must sign in or register with ${INVITEE_EMAIL} to accept this invite.`);
    expect(actualMail.html).not.toContain("sent to .");
    expect(actualMail.text).not.toContain("register with  ");
  });

  it("names the job recipient in the HTML and text for a job queued by resend", async () => {
    const inputJob: EmailJobRow = {
      id: "job-resend-made-up",
      type: "workspace_invite",
      recipientEmail: INVITEE_EMAIL,
      payload: {
        inviteId: "invite-made-up",
        token: TOKEN_MADE_UP,
        workspaceName: "Workspace Made Up",
        inviterEmail: "inviter@example.com",
        role: "admin",
        expiresAt: EXPIRES_AT_ISO,
      },
    };

    const actualMail = await processJobAndCaptureMail(inputJob);

    expect(actualMail.to).toBe(INVITEE_EMAIL);
    expect(actualMail.html).toContain(`This invite was sent to ${INVITEE_EMAIL}.`);
    expect(actualMail.text).toContain(`You must sign in or register with ${INVITEE_EMAIL} to accept this invite.`);
    expect(actualMail.html).not.toContain("sent to .");
    expect(actualMail.text).not.toContain("register with  ");
  });
});
