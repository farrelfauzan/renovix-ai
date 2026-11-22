import type { CreditMeterLevel } from "./credit-meter-level";
import type { RunOutProjection } from "./run-out-projection";

/** RNX-329: a paid wallet's run-out projection, warning level and floor flag (`evaluateCreditMeter`). */
export type CreditMeterEvaluation = {
  readonly projection: RunOutProjection;
  /** The projected run-out instant; null without a projected date. */
  readonly runOutAt: Date | null;
  readonly level: CreditMeterLevel;
  readonly belowFloor: boolean;
};
