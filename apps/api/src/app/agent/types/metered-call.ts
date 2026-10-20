import type { ChatRequest } from "../../providers/provider.interface";

/** One model call of a run: the agent that makes it, the caller's model call that started this hop (null for the root agent), the request. */
export type MeteredCall = {
  readonly agentId: string;
  readonly parentCallId: string | null;
  readonly request: ChatRequest;
};
