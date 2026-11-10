import type { ChatPeerCallRequest } from "../types/chat-peer-call-request";

/**
 * RNX-283: the agent-call (peer) extension point, injected. Empty for now (config/unavailable-peer-call.ts): a call_agent
 * attempt calls nothing and gets the "unavailable" text. Delegation (child runs, depth, cycles, budget) is RNX-121.
 */
export abstract class ChatEnginePeerCall {
  /** The tool result of one call_agent attempt. */
  abstract callPeer(request: ChatPeerCallRequest): Promise<string>;
}
