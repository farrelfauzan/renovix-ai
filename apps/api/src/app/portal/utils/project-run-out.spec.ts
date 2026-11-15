import { Decimal } from "@prisma/client/runtime/client";
import type { RunOutProjectionInput } from "../types/run-out-projection-input";
import { projectRunOut } from "./project-run-out";

// RNX-30-A AC1: the run-out projection (D45). Settings use non-default values (seeded: projectionMinSpendCredits 1,
// projectionMaxDays 365). The rate is the window's spend / 7; run-out = now + available / rate.
const BASE: RunOutProjectionInput = {
  now: new Date("2026-11-15T10:20:00.000Z"),
  paidAvailable: new Decimal(10),
  spentInWindow: new Decimal(7),
  usageDays: 3,
  timeZone: "UTC",
  minSpendCredits: 2,
  maxDays: 30,
};

describe("projectRunOut (RNX-30-A AC1)", () => {
  it("a known 7-day history: 7 credits in 7 days is 1 a day, 10 available run out in 10 days, shown at the hour (HH:00)", () => {
    const actual = projectRunOut(BASE);

    expect(actual).toEqual({ status: "date", runOutAt: new Date("2026-11-25T10:20:00.000Z"), runOutLabel: "25/11/2026 10:00", timeZone: "UTC" });
  });

  it("Asia/Jakarta: the label is the local day and hour, which differ from UTC's", () => {
    const input = { ...BASE, now: new Date("2026-11-15T08:30:00.000Z"), paidAvailable: new Decimal("2.5"), timeZone: "Asia/Jakarta" };

    const actual = projectRunOut(input);

    // 2.5 days after 08:30Z on 15/11 is 20:30Z on 17/11, which is 03:30 on 18/11 in Jakarta (UTC+7).
    expect(actual).toEqual({ status: "date", runOutAt: new Date("2026-11-17T20:30:00.000Z"), runOutLabel: "18/11/2026 03:00", timeZone: "Asia/Jakarta" });
  });

  it("a DST zone: America/New_York uses the offset of the run-out instant (EST after 1 November), not of now (EDT)", () => {
    const input = { ...BASE, now: new Date("2026-10-30T12:00:00.000Z"), paidAvailable: new Decimal(3), timeZone: "America/New_York" };

    const actual = projectRunOut(input);

    expect(actual).toEqual({ status: "date", runOutAt: new Date("2026-11-02T12:00:00.000Z"), runOutLabel: "02/11/2026 07:00", timeZone: "America/New_York" });
  });

  it("exact decimal rate: 9.481330 spent and 11.734210 available run out in 8.6633 days (docs/credits.md section 12)", () => {
    const input = { ...BASE, spentInWindow: new Decimal("9.481330"), paidAvailable: new Decimal("11.734210") };

    const actual = projectRunOut(input);

    // 11.734210 * 7 / 9.481330 days = 748,507,878.96 ms, floored.
    expect(actual).toMatchObject({ status: "date", runOutAt: new Date(BASE.now.getTime() + 748_507_878) });
  });

  it("nothing available with enough use: the run-out is now", () => {
    const actual = projectRunOut({ ...BASE, paidAvailable: new Decimal(0) });

    expect(actual).toMatchObject({ status: "date", runOutAt: BASE.now, runOutLabel: "15/11/2026 10:00" });
  });

  it.each<[string, Partial<RunOutProjectionInput>]>([
    ["fewer than 3 distinct usage days", { usageDays: 2 }],
    ["a spend below projectionMinSpendCredits", { spentInWindow: new Decimal("1.999999") }],
    ["no spend at all, even with projectionMinSpendCredits 0", { spentInWindow: new Decimal(0), minSpendCredits: 0 }],
    ["projectionMinSpendCredits not set", { minSpendCredits: null }],
    ["projectionMaxDays not set", { maxDays: null }],
  ])("%s: not enough use", (_case, override) => {
    const actual = projectRunOut({ ...BASE, ...override });

    expect(actual).toEqual({ status: "not_enough_use" });
  });

  it("a spend equal to projectionMinSpendCredits and exactly 3 days: projected", () => {
    const actual = projectRunOut({ ...BASE, spentInWindow: new Decimal(2), paidAvailable: new Decimal(2) });

    expect(actual).toMatchObject({ status: "date", runOutAt: new Date("2026-11-22T10:20:00.000Z") });
  });

  it("a run-out beyond projectionMaxDays: more than a year; exactly projectionMaxDays away: a date", () => {
    const actualBeyond = projectRunOut({ ...BASE, paidAvailable: new Decimal("30.000001") });
    const actualAtMax = projectRunOut({ ...BASE, paidAvailable: new Decimal(30) });

    expect(actualBeyond).toEqual({ status: "more_than_a_year" });
    expect(actualAtMax).toMatchObject({ status: "date", runOutAt: new Date("2026-12-15T10:20:00.000Z") });
  });
});
