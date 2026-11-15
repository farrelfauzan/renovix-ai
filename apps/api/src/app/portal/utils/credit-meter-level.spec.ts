import type { CreditMeterLevelInput } from "../types/credit-meter-level-input";
import { creditMeterLevel } from "./credit-meter-level";

// RNX-30-A AC2 (unit part): the level follows runOutAmberDays and runOutRedDays, here 10 and 3 (seeded: 7 and 2).
const NOW = new Date("2026-11-15T00:00:00.000Z");
const inDays = (days: number): Date => new Date(NOW.getTime() + days * 24 * 60 * 60 * 1000);
const BASE: CreditMeterLevelInput = { now: NOW, runOutAt: null, amberDays: 10, redDays: 3 };

describe("creditMeterLevel (RNX-30-A AC2)", () => {
  it.each<[string, Partial<CreditMeterLevelInput>, string]>([
    ["run-out in 2.5 days, red at 3", { runOutAt: inDays(2.5) }, "red"],
    ["run-out in exactly 3 days", { runOutAt: inDays(3) }, "red"],
    ["run-out in 3 days and a minute: amber (would be none with the seeded 7)", { runOutAt: inDays(3.001) }, "amber"],
    ["run-out in 8 days: amber at 10 (none with the seeded 7)", { runOutAt: inDays(8) }, "amber"],
    ["run-out in exactly 10 days", { runOutAt: inDays(10) }, "amber"],
    ["run-out in 10.5 days", { runOutAt: inDays(10.5) }, "none"],
    ["no projected date", { runOutAt: null }, "none"],
    ["runOutRedDays not set: the red check is skipped", { runOutAt: inDays(1), redDays: null }, "amber"],
    ["runOutAmberDays not set: the amber check is skipped", { runOutAt: inDays(8), amberDays: null }, "none"],
    ["neither set", { runOutAt: inDays(1), amberDays: null, redDays: null }, "none"],
  ])("%s: %s", (_case, override, expected) => {
    const actual = creditMeterLevel({ ...BASE, ...override });

    expect(actual).toBe(expected);
  });
});
