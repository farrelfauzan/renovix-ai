import type { CreditWarningLevel } from "@generated/prisma/client.js";
import type { CreditWarningEmailPayload } from "../types/credit-warning-email-payload";
import { escapeHtml } from "./escape-html";

/** The subject, heading and lead sentence of each warning; the lead uses the payload's figures. */
const COPY: Record<CreditWarningLevel, { subject: string; heading: string; lead: (payload: CreditWarningEmailPayload) => string }> = {
  amber: {
    subject: "Your Renovix AI credits will run out soon",
    heading: "Your credits will run out soon",
    lead: (payload) => `At your current pace, your paid credits will run out around ${payload.runOutLabel} (${payload.timeZone}). You have ${payload.paidAvailable} credits left.`,
  },
  red: {
    subject: "Your Renovix AI credits are about to run out",
    heading: "Your credits are about to run out",
    lead: (payload) => `At your current pace, your paid credits will run out around ${payload.runOutLabel} (${payload.timeZone}). You have ${payload.paidAvailable} credits left.`,
  },
  floor: {
    subject: "Your Renovix AI credits are low",
    heading: "Your credits are low",
    lead: (payload) => `You have ${payload.paidAvailable} paid credits left, which may not be enough for your next chats and scheduled runs.`,
  },
};
const ADVICE = "Top up your credits in Renovix AI to keep your chats and scheduled runs going.";
const FOOTER = "We send this email at most once per credit purchase. Your free weekly credits are not counted here.";
const RUNS_INTRO = "These scheduled runs are due before then and may not run once your credits are used up:";

/**
 * RNX-329: the run-out warning mail (amber, red or floor), in the style of the workspace invite mail. The red mail lists
 * the scheduled runs of its payload, times in the owner's timezone; their labels are user text and are escaped.
 */
export function buildCreditWarningEmail(payload: CreditWarningEmailPayload): { subject: string; html: string; text: string } {
  const copy = COPY[payload.level];
  const formatRunAt = new Intl.DateTimeFormat("en-GB", { timeZone: payload.timeZone, dateStyle: "short", timeStyle: "short" });
  const runs = payload.reminders.map((run) => ({ label: run.description ?? "Scheduled run", at: formatRunAt.format(new Date(run.nextRunAt)) }));
  const runsHtml = runs.length === 0 ? "" : `
              <p style="margin: 0 0 8px; font-size: 14px; line-height: 1.5; color: #52525b;">${RUNS_INTRO}</p>
              <ul style="margin: 0 0 16px; padding-left: 20px; font-size: 14px; line-height: 1.5; color: #27272a;">
${runs.map((run) => `                <li>${escapeHtml(run.label)} (${run.at})</li>`).join("\n")}
              </ul>`;
  const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${copy.heading}</title>
</head>
<body style="margin: 0; padding: 0; background-color: #f4f4f5; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background-color: #f4f4f5;">
    <tr>
      <td align="center" style="padding: 40px 20px;">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width: 480px; background-color: #ffffff; border-radius: 12px; overflow: hidden; box-shadow: 0 1px 3px rgba(0,0,0,0.1);">
          <tr>
            <td style="padding: 32px 32px 0; text-align: center;">
              <h1 style="margin: 0 0 4px; font-size: 20px; font-weight: 600; color: #18181b;">
                ${copy.heading}
              </h1>
              <p style="margin: 0; font-size: 13px; color: #71717a;">Renovix AI</p>
            </td>
          </tr>
          <tr>
            <td style="padding: 24px 32px;">
              <p style="margin: 0 0 16px; font-size: 15px; line-height: 1.5; color: #27272a;">
                ${copy.lead(payload)}
              </p>${runsHtml}
              <p style="margin: 0; font-size: 14px; line-height: 1.5; color: #52525b;">
                ${ADVICE}
              </p>
            </td>
          </tr>
          <tr>
            <td style="padding: 0 32px 32px;">
              <hr style="border: none; border-top: 1px solid #e4e4e7; margin: 24px 0;" />
              <p style="margin: 0; font-size: 12px; line-height: 1.5; color: #a1a1aa;">
                ${FOOTER}
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`.trim();
  const runsText = runs.length === 0 ? "" : `\n${RUNS_INTRO}\n${runs.map((run) => `- ${run.label} (${run.at})`).join("\n")}\n`;
  const text = `${copy.heading}

${copy.lead(payload)}
${runsText}
${ADVICE}

${FOOTER}`;
  return { subject: copy.subject, html, text };
}
