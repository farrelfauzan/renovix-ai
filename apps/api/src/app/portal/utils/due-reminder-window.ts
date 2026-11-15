import type { TimeWindow } from "../types/time-window";
import { MS_PER_DAY } from "../config/ms-per-day";

/**
 * RNX-30-A: the window whose active reminders count as "due" for the floor check (each needs perRunCreditCap). Today
 * (option A'): the next runOutAmberDays days from now, whatever the projection. The rule lives only here, so a
 * change of definition is a change of this one line. null when runOutAmberDays is not set (the check is skipped).
 */
export function dueReminderWindow(now: Date, amberDays: number | null): TimeWindow | null {
  return amberDays === null ? null : { from: now, to: new Date(now.getTime() + amberDays * MS_PER_DAY) };
}
