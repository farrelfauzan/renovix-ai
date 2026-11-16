import { dueReminderWindow } from "./due-reminder-window";

describe("dueReminderWindow (RNX-30-A, option A': the next runOutAmberDays days, whatever the projection)", () => {
  it("runOutAmberDays 10: from now to now + 10 days", () => {
    const inputNow = new Date("2026-11-15T10:20:00.000Z");

    const actual = dueReminderWindow(inputNow, 10);

    expect(actual).toEqual({ from: inputNow, to: new Date("2026-11-25T10:20:00.000Z") });
  });

  it("runOutAmberDays not set: no window (the reminder part of the floor check is skipped)", () => {
    const actual = dueReminderWindow(new Date(), null);

    expect(actual).toBeNull();
  });
});
