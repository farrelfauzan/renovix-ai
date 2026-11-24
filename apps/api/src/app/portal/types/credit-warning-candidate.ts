import type { CreditWarningLevel } from "@generated/prisma/client.js";

/** RNX-329: one paid account the run-out warning check looks at (`CreditWarningRepository.findAccountsToCheck`). */
export type CreditWarningCandidate = {
  readonly accountId: string;
  /** The account's owner: its warning emails go to this user's email only. */
  readonly userId: string;
  readonly ownerEmail: string;
  /** The owner's stored profile timezone, as stored (see `resolveProfileTimeZone`). */
  readonly timeZone: string | null;
  /** The paid wallet's balance, a decimal string, 0 included; open holds are not subtracted (D387). */
  readonly paidBalance: string;
  /** The createdAt of the account's latest top_up or plan_grant entry, to the millisecond: the purchase cycle's key. */
  readonly cycleStartedAt: Date;
  /** The warnings already queued for the account in this cycle. */
  readonly recordedLevels: readonly CreditWarningLevel[];
};
