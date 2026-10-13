import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";

interface InviteTemplateData {
  workspaceName: string;
  inviterEmail: string;
  role: string;
  expiresAt: string;
  acceptUrl: string;
  recipientEmail: string;
}

@Injectable()
export class EmailTemplateService {
  constructor(private readonly config: ConfigService) {}

  private getBaseUrl(): string {
    return this.config.get<string>("APP_BASE_URL", "https://chat.performa.ai");
  }

  buildInviteEmail(data: InviteTemplateData): {
    subject: string;
    html: string;
    text: string;
  } {
    const subject = `You've been invited to join ${data.workspaceName} on Performa AI`;

    const expiryDate = new Date(data.expiresAt).toLocaleDateString("en-US", {
      year: "numeric",
      month: "long",
      day: "numeric",
    });

    const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Workspace Invite</title>
</head>
<body style="margin: 0; padding: 0; background-color: #f4f4f5; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background-color: #f4f4f5;">
    <tr>
      <td align="center" style="padding: 40px 20px;">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width: 480px; background-color: #ffffff; border-radius: 12px; overflow: hidden; box-shadow: 0 1px 3px rgba(0,0,0,0.1);">
          <!-- Header -->
          <tr>
            <td style="padding: 32px 32px 0; text-align: center;">
              <h1 style="margin: 0 0 4px; font-size: 20px; font-weight: 600; color: #18181b;">
                Join Workspace
              </h1>
              <p style="margin: 0; font-size: 13px; color: #71717a;">Performa AI</p>
            </td>
          </tr>

          <!-- Body -->
          <tr>
            <td style="padding: 24px 32px;">
              <p style="margin: 0 0 16px; font-size: 15px; line-height: 1.5; color: #27272a;">
                <strong>${data.inviterEmail}</strong> invited you to join <strong>${data.workspaceName}</strong> on Performa AI.
              </p>

              <!-- Info card -->
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background-color: #f4f4f5; border-radius: 8px; margin-bottom: 24px;">
                <tr>
                  <td style="padding: 16px;">
                    <p style="margin: 0 0 4px; font-size: 13px; color: #71717a;">Role</p>
                    <p style="margin: 0 0 12px; font-size: 14px; font-weight: 500; color: #18181b; text-transform: capitalize;">${data.role}</p>
                    <p style="margin: 0 0 4px; font-size: 13px; color: #71717a;">Expires</p>
                    <p style="margin: 0; font-size: 14px; font-weight: 500; color: #18181b;">${expiryDate}</p>
                  </td>
                </tr>
              </table>

              <p style="margin: 0 0 24px; font-size: 14px; line-height: 1.5; color: #52525b;">
                Join this workspace to access shared AI agents, workspace knowledge, and team memory. Your private chat history will remain private to your account.
              </p>

              <!-- CTA Button -->
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0">
                <tr>
                  <td align="center">
                    <a href="${data.acceptUrl}" target="_blank" style="display: inline-block; padding: 12px 32px; background-color: #6366f1; color: #ffffff; font-size: 15px; font-weight: 600; text-decoration: none; border-radius: 8px;">
                      Accept Invitation
                    </a>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="padding: 0 32px 32px;">
              <hr style="border: none; border-top: 1px solid #e4e4e7; margin: 24px 0;" />
              <p style="margin: 0 0 8px; font-size: 12px; line-height: 1.5; color: #a1a1aa;">
                If the button does not work, copy and paste this link into your browser:
              </p>
              <p style="margin: 0 0 16px; font-size: 12px; line-height: 1.5; color: #6366f1; word-break: break-all;">
                ${data.acceptUrl}
              </p>
              <p style="margin: 0; font-size: 12px; line-height: 1.5; color: #a1a1aa;">
                This invite was sent to ${data.recipientEmail}. You must sign in or register with this email address to accept it. If you were not expecting this invite, you can ignore this email.
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`.trim();

    const text = `Join Workspace

${data.inviterEmail} invited you to join ${data.workspaceName} on Performa AI.
Role: ${data.role}
Expires: ${expiryDate}

Join this workspace to access shared AI agents, workspace knowledge, and team memory.
Your private chat history will remain private to your account.

Accept invitation:
${data.acceptUrl}

You must sign in or register with ${data.recipientEmail} to accept this invite.
If you were not expecting this email, you can ignore it.`;

    return { subject, html, text };
  }

  getAcceptUrl(token: string): string {
    return `${this.getBaseUrl()}/workspace-invites/accept?token=${token}`;
  }
}
