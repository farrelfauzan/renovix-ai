import type { CreditMeterEvaluation } from "../types/credit-meter-evaluation";
import type { CreditMeterEvaluationInput } from "../types/credit-meter-evaluation-input";
import { creditMeterLevel } from "./credit-meter-level";
import { isBelowFloor } from "./is-below-floor";
import { projectRunOut } from "./project-run-out";

/**
 * RNX-329: a paid wallet's run-out projection, warning level and floor flag (RNX-30-A, D45, D47), the one rule the credit
 * meter route and the run-out warning check share, so the level a user sees and the email they get cannot drift.
 */
export function evaluateCreditMeter(input: CreditMeterEvaluationInput): CreditMeterEvaluation {
  const { now, paidAvailable, settings } = input;
  const projection = projectRunOut({
    now,
    paidAvailable,
    spentInWindow: input.usage.spent,
    usageDays: input.usage.usageDays,
    timeZone: input.timeZone,
    minSpendCredits: settings.projectionMinSpendCredits,
    maxDays: settings.projectionMaxDays,
  });
  const runOutAt = projection.status === "date" ? projection.runOutAt : null;
  return {
    projection,
    runOutAt,
    level: creditMeterLevel({ now, runOutAt, amberDays: settings.runOutAmberDays, redDays: settings.runOutRedDays }),
    belowFloor: isBelowFloor({ paidAvailable, floorCredits: settings.runOutFloorCredits, perRunCreditCap: settings.perRunCreditCap, dueReminderCount: input.dueReminderCount }),
  };
}
