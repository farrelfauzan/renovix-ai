import type { RunScope } from "../../agent/types/run-scope";
import type { ChatHopEvent } from "./chat-hop-event";
import type { ChatModelCall } from "./chat-model-call";

/**
 * RNX-283: a call_agent attempt as the peer port receives it: who runs, which agent asks, and the model's arguments (not
 * checked). RNX-25 (D341 D1): the run's scope, the calling model call (the hop's parent) and the run's metered model
 * call, so a hop is metered on the run's reservation against the called agent's connection with that parent.
 * RNX-328: `onHopEvent` takes the start and end of every hop this call makes, as they happen.
 */
export type ChatPeerCallRequest = {
  readonly runnerUserId: string;
  readonly agentId: string;
  readonly args: unknown;
  readonly scope: RunScope;
  readonly parentCallId: string;
  readonly callModel: ChatModelCall;
  readonly onHopEvent: (event: ChatHopEvent) => void;
};
