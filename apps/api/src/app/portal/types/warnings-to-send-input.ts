import type { CreditWarningLevel } from "@generated/prisma/client.js";
import type { CreditMeterLevel } from "./credit-meter-level";

/** RNX-329: what `pickWarningsToSend` needs about one paid account. */
export type WarningsToSendInput = {
  readonly level: CreditMeterLevel;
  readonly belowFloor: boolean;
  /** The warnings already queued for the account in its current purchase cycle. */
  readonly recorded: readonly CreditWarningLevel[];
};
