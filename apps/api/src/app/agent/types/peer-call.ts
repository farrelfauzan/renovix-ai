import type { ChatPeerCallRequest } from "../../chat-engine/types/chat-peer-call-request";
import type { CallableAgent } from "./callable-agent";
import type { PeerCallFrame } from "./peer-call-frame";

/**
 * RNX-121b-1: one call_agent call whose arguments are valid and whose agent the caller may call: the caller's frame,
 * the peer port's request, the called agent and its input (the task, with the optional context).
 */
export type PeerCall = {
  readonly frame: PeerCallFrame;
  readonly request: ChatPeerCallRequest;
  readonly callee: CallableAgent;
  readonly task: string;
};
