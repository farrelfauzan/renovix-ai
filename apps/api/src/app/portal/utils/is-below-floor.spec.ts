import { Decimal } from "@prisma/client/runtime/client";
import type { FloorCheckInput } from "../types/floor-check-input";
import { isBelowFloor } from "./is-below-floor";

// RNX-30-A AC2 (unit part): the floor flag, with runOutFloorCredits 5 and perRunCreditCap 4 (seeded: 1 and 10).
const BASE: FloorCheckInput = { paidAvailable: new Decimal(100), floorCredits: 5, perRunCreditCap: 4, dueReminderCount: 0 };

describe("isBelowFloor (RNX-30-A AC2)", () => {
  it.each<[string, Partial<FloorCheckInput>, boolean]>([
    ["below runOutFloorCredits", { paidAvailable: new Decimal("4.999999") }, true],
    ["at runOutFloorCredits", { paidAvailable: new Decimal(5) }, false],
    ["below perRunCreditCap x 3 due reminders (12)", { paidAvailable: new Decimal("11.999999"), dueReminderCount: 3 }, true],
    ["at perRunCreditCap x 3 due reminders", { paidAvailable: new Decimal(12), dueReminderCount: 3 }, false],
    ["no due reminder", { paidAvailable: new Decimal(6), dueReminderCount: 0 }, false],
    ["runOutFloorCredits not set: only the reminder part", { paidAvailable: new Decimal(1), floorCredits: null }, false],
    ["perRunCreditCap not set: only the floor part", { paidAvailable: new Decimal(6), perRunCreditCap: null, dueReminderCount: 9 }, false],
    ["neither set", { paidAvailable: new Decimal(0), floorCredits: null, perRunCreditCap: null, dueReminderCount: 9 }, false],
  ])("%s: %s", (_case, override, expected) => {
    const actual = isBelowFloor({ ...BASE, ...override });

    expect(actual).toBe(expected);
  });
});
