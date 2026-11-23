import type { CreditWarningEmailPayload } from "../types/credit-warning-email-payload";
import { buildCreditWarningEmail } from "./build-credit-warning-email";

// RNX-329: the three run-out warning mails. The red one lists the scheduled runs of its payload, in the owner's timezone.
const BASE: CreditWarningEmailPayload = { level: "amber", paidBalance: "16", runOutLabel: "30/11/2026 07:00", timeZone: "Asia/Jakarta", reminders: [] };

describe("buildCreditWarningEmail (RNX-329)", () => {
  it.each<[CreditWarningEmailPayload["level"], string]>([
    ["amber", "Your Renovix AI credits will run out soon"],
    ["red", "Your Renovix AI credits are about to run out"],
    ["floor", "Your Renovix AI credits are low"],
  ])("%s: its own subject, and the credits left in the text and the HTML", (level, expectedSubject) => {
    const actual = buildCreditWarningEmail({ ...BASE, level });

    expect(actual.subject).toBe(expectedSubject);
    expect(actual.text).toContain("16");
    expect(actual.html).toContain("16");
  });

  it("amber and red name the run-out date and timezone", () => {
    const actual = buildCreditWarningEmail({ ...BASE, level: "red" });

    expect(actual.text).toContain("around 30/11/2026 07:00 (Asia/Jakarta)");
  });

  it("red with scheduled runs: each listed with its time in the owner's timezone; a label is escaped in the HTML", () => {
    const actual = buildCreditWarningEmail({
      ...BASE,
      level: "red",
      reminders: [
        { description: "<b>Daily</b> report", nextRunAt: "2026-11-23T01:30:00.000Z" },
        { description: null, nextRunAt: "2026-11-24T01:30:00.000Z" },
      ],
    });

    expect(actual.text).toContain("- <b>Daily</b> report (23/11/2026, 08:30)");
    expect(actual.text).toContain("- Scheduled run (24/11/2026, 08:30)");
    expect(actual.html).toContain("<li>&lt;b&gt;Daily&lt;/b&gt; report (23/11/2026, 08:30)</li>");
    expect(actual.html).not.toContain("<b>Daily</b>");
  });

  it("no scheduled runs: no list", () => {
    const actual = buildCreditWarningEmail({ ...BASE, level: "red" });

    expect(actual.html).not.toContain("<ul");
    expect(actual.text).not.toContain("scheduled runs are due");
  });
});
