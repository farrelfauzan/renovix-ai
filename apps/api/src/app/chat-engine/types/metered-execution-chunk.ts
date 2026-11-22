import type { ChatExecutionChunk } from "./chat-execution-chunk";

/**
 * RNX-282: what a metered execution yields: the execution's chunks, then, when the run stopped at its credit budget, the
 * budget-stop message (the raw answer in place of any text). RNX-326: `limit_stopped`, the same message for a run with
 * agent calls that stopped at a run limit (its model-call cap or its run time).
 */
export type MeteredExecutionChunk =
  | ChatExecutionChunk
  | { readonly type: "budget_stopped"; readonly message: string }
  | { readonly type: "limit_stopped"; readonly message: string };
