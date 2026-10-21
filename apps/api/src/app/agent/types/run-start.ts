import type { ChatRequest } from "../../providers/provider.interface";
import type { LinkedAgent } from "./linked-agent";

/**
 * What an agent run needs before its first model call (docs/credits.md section 13.3): the runner who pays, the root
 * agent's first request (its counted prompt and max_tokens give E_call(root)) and the agents the root may call.
 * RNX-162: the run's workspace, on each call's model_call_costs row (a linked callee is in the same workspace).
 */
export type RunStart = {
  readonly runnerUserId: string;
  readonly workspaceId?: string;
  readonly firstCall: ChatRequest;
  readonly linkedAgents: readonly LinkedAgent[];
};
