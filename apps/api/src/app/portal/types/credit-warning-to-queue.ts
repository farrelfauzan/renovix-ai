import type { CreditWarningLevel } from "@generated/prisma/client.js";
import type { CreditMeterEvaluation } from "./credit-meter-evaluation";
import type { CreditWarningCandidate } from "./credit-warning-candidate";

/** RNX-329: one warning the run-out warning check records and mails, unless another check run already did. */
export type CreditWarningToQueue = {
  readonly candidate: CreditWarningCandidate;
  readonly level: CreditWarningLevel;
  readonly evaluation: CreditMeterEvaluation;
  readonly timeZone: string;
  readonly now: Date;
};
