import type { ChildRunStatus } from "../../agent/types/child-run-status";

/**
 * RNX-328: a hop (an agent called with call_agent) starting or ending, as the run reports it while it runs: the called
 * agent, its depth (1 for an agent the run's own agent calls) and, at its end, the status its child run row records
 * (RNX-302). Only a hop that writes a child row has events (D351 6): a refusal that writes no row has none.
 */
export type ChatHopEvent =
  | { readonly type: "hop_start"; readonly agentId: string; readonly agentName: string; readonly depth: number }
  | { readonly type: "hop_end"; readonly agentId: string; readonly agentName: string; readonly depth: number; readonly status: ChildRunStatus };
