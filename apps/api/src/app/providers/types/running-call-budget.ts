import type { CallBudget } from "./call-budget";

/** RNX-44: a call budget whose timer is running; `stop` clears it, so its signal never fires (a call that ended, a first token). */
export interface RunningCallBudget extends CallBudget {
  readonly stop: () => void;
}
