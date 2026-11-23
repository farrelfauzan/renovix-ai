import type { CreditWarningLevel } from "@generated/prisma/client.js";

/** RNX-329: what a run-out warning mail is built from, stored in its EmailJob's payload (never logged). */
export type CreditWarningEmailPayload = {
  readonly level: CreditWarningLevel;
  /** The paid wallet's balance when the warning was queued (open holds not subtracted, D387), a decimal string. */
  readonly paidBalance: string;
  /** The projected run-out, "DD/MM/YYYY HH:00" in `timeZone`; null without a projected date (a floor warning can have none). */
  readonly runOutLabel: string | null;
  /** The owner's profile timezone, an IANA name. */
  readonly timeZone: string;
  /** Red only: the scheduled runs due before the run-out, soonest first, at most RED_STATE_REMINDER_LIMIT; empty otherwise. */
  readonly reminders: ReadonlyArray<{ readonly description: string | null; readonly nextRunAt: string }>;
};
