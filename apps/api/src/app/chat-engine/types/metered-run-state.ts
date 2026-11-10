import type { AgentRunBudget } from "../../agent/types/agent-run-budget";
import type { ModelConnection } from "../../providers/types/model-connection";
import type { MeteredExecutionTarget } from "./metered-execution-target";

/**
 * RNX-282: one metered execution's run, local to that execution: whose run it is, the model's connection, its
 * reservation once the first call opened it, and the tail of its call queue (its calls run one at a time, so each
 * call's budget check sees the charge of the call before it).
 */
export type MeteredRunState = {
  readonly target: MeteredExecutionTarget;
  readonly connection: ModelConnection;
  opened?: Promise<AgentRunBudget>;
  queue: Promise<unknown>;
};
