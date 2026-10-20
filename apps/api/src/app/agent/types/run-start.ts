import type { ChatRequest } from "../../providers/provider.interface";
import type { LinkedAgent } from "./linked-agent";

/**
 * What an agent run needs before its first model call (docs/credits.md section 13.3): the runner who pays, the root
 * agent's first request (its counted prompt and max_tokens give E_call(root)) and the agents the root may call.
 */
export type RunStart = {
  readonly runnerUserId: string;
  readonly firstCall: ChatRequest;
  readonly linkedAgents: readonly LinkedAgent[];
};
