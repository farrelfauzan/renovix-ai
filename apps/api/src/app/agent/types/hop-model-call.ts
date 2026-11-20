import type { ChatHopTarget } from "../../chat-engine/types/chat-hop-target";
import type { ChatModelCall } from "../../chat-engine/types/chat-model-call";

/**
 * RNX-121b-1: how a called agent's model calls are made: through its caller's metered call (so on the run's one
 * reservation), as the hop's target (the called agent, its connection without fallback models, the calling model call
 * as parent), each one attempt within `timeoutMs`.
 */
export type HopModelCall = {
  readonly callerCallModel: ChatModelCall;
  readonly target: ChatHopTarget;
  readonly timeoutMs: number;
};
