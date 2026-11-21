import { Decimal } from "@prisma/client/runtime/client";
import { ProviderAttemptDeadlineError } from "../../providers/errors/provider-attempt-deadline-error";
import { RunBudgetStoppedError } from "../errors/run-budget-stopped.error";
import { RunLimitStoppedError } from "../errors/run-limit-stopped.error";
import { toHopStatus } from "./to-hop-status";

// RNX-121b-1, RNX-326: the child-run status of a hop that failed, by its error.
describe("toHopStatus", () => {
  it.each([
    ["the run's budget stop", new RunBudgetStoppedError(new Decimal("0.01")), "budget_stopped"],
    ["its model call's own deadline", new ProviderAttemptDeadlineError(), "timeout"],
    ["the run's time limit (RNX-326)", new RunLimitStoppedError("run_time"), "timeout"],
    ["the run's model-call cap (RNX-326)", new RunLimitStoppedError("model_calls"), "error"],
    ["any other error", new Error("boom"), "error"],
  ])("%s", (_case, inputError, expected) => {
    const actual = toHopStatus(inputError);

    expect(actual).toBe(expected);
  });
});
