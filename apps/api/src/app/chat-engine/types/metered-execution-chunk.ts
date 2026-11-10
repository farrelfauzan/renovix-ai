import type { ChatExecutionChunk } from "./chat-execution-chunk";

/** RNX-282: what a metered execution yields: the execution's chunks, then, when the run stopped at its credit budget, the budget-stop message (the raw answer in place of any text). */
export type MeteredExecutionChunk = ChatExecutionChunk | { readonly type: "budget_stopped"; readonly message: string };
