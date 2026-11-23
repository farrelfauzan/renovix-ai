import { Prisma } from "@generated/prisma/client.js";
import type { CreditMeterEvaluationInput } from "../types/credit-meter-evaluation-input";
import { evaluateCreditMeter } from "./evaluate-credit-meter";

// RNX-329: the shared rule of the credit meter route and the run-out check: projection, level and floor flag from one
// wallet's figures and the six settings (non-default values: amber 10, red 3, floor 5, perRunCreditCap 7).
const NOW = new Date("2026-11-22T00:00:00.000Z");
const DAY_MS = 24 * 60 * 60 * 1000;
const BASE: CreditMeterEvaluationInput = {
  now: NOW,
  paidAvailable: new Prisma.Decimal(16),
  usage: { spent: new Prisma.Decimal(14), usageDays: 4 },
  timeZone: "UTC",
  dueReminderCount: 0,
  settings: { projectionMinSpendCredits: 2, projectionMaxDays: 30, runOutAmberDays: 10, runOutRedDays: 3, runOutFloorCredits: 5, perRunCreditCap: 7 },
};

describe("evaluateCreditMeter (RNX-329)", () => {
  it("16 credits at 2 a day: run-out in 8 days, amber, not below the floor", () => {
    const actual = evaluateCreditMeter(BASE);

    expect(actual).toMatchObject({ level: "amber", belowFloor: false, projection: { status: "date" } });
    expect(actual.runOutAt?.getTime()).toBe(NOW.getTime() + 8 * DAY_MS);
  });

  it("4 credits at 2 a day: red and below the floor", () => {
    const actual = evaluateCreditMeter({ ...BASE, paidAvailable: new Prisma.Decimal(4) });

    expect(actual).toMatchObject({ level: "red", belowFloor: true });
  });

  it("6 credits and one due reminder needing 7: below the floor; not enough use: no run-out, level none", () => {
    const actual = evaluateCreditMeter({ ...BASE, paidAvailable: new Prisma.Decimal(6), usage: { spent: new Prisma.Decimal(14), usageDays: 2 }, dueReminderCount: 1 });

    expect(actual).toEqual({ projection: { status: "not_enough_use" }, runOutAt: null, level: "none", belowFloor: true });
  });
});
