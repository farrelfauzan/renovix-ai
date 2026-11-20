/**
 * RNX-78: the mail that confirms a new email address, in the style of the workspace invite mail. The address changes
 * only when the link is opened; until then the old address stays the sign-in email.
 */
export function buildEmailChangeVerificationEmail({
  verifyUrl,
  recipientEmail,
}: {
  readonly verifyUrl: string;
  readonly recipientEmail: string;
}): { subject: string; html: string; text: string } {
  const subject = "Confirm your new email address for Renovix AI";
  const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Confirm your new email address</title>
</head>
<body style="margin: 0; padding: 0; background-color: #f4f4f5; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background-color: #f4f4f5;">
    <tr>
      <td align="center" style="padding: 40px 20px;">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width: 480px; background-color: #ffffff; border-radius: 12px; overflow: hidden; box-shadow: 0 1px 3px rgba(0,0,0,0.1);">
          <tr>
            <td style="padding: 32px 32px 0; text-align: center;">
              <h1 style="margin: 0 0 4px; font-size: 20px; font-weight: 600; color: #18181b;">
                Confirm your new email address
              </h1>
              <p style="margin: 0; font-size: 13px; color: #71717a;">Renovix AI</p>
            </td>
          </tr>
          <tr>
            <td style="padding: 24px 32px;">
              <p style="margin: 0 0 24px; font-size: 15px; line-height: 1.5; color: #27272a;">
                Someone asked to use <strong>${recipientEmail}</strong> as the sign-in email of a Renovix AI account. The change takes effect when you open the link below.
              </p>
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0">
                <tr>
                  <td align="center">
                    <a href="${verifyUrl}" target="_blank" style="display: inline-block; padding: 12px 32px; background-color: #6366f1; color: #ffffff; font-size: 15px; font-weight: 600; text-decoration: none; border-radius: 8px;">
                      Confirm email address
                    </a>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
          <tr>
            <td style="padding: 0 32px 32px;">
              <hr style="border: none; border-top: 1px solid #e4e4e7; margin: 24px 0;" />
              <p style="margin: 0 0 8px; font-size: 12px; line-height: 1.5; color: #a1a1aa;">
                If the button does not work, copy and paste this link into your browser:
              </p>
              <p style="margin: 0 0 16px; font-size: 12px; line-height: 1.5; color: #6366f1; word-break: break-all;">
                ${verifyUrl}
              </p>
              <p style="margin: 0; font-size: 12px; line-height: 1.5; color: #a1a1aa;">
                The link expires in one hour. If you did not ask for this change, you can ignore this email; nothing changes.
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`.trim();
  const text = `Confirm your new email address

Someone asked to use ${recipientEmail} as the sign-in email of a Renovix AI account.
The change takes effect when you open this link:
${verifyUrl}

The link expires in one hour. If you did not ask for this change, you can ignore this email; nothing changes.`;
  return { subject, html, text };
}
