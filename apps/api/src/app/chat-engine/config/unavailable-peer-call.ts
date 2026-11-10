import type { ChatEnginePeerCall } from "../ports/chat-engine-peer-call.port";
import { CHAT_ENGINE_PEER_UNAVAILABLE } from "./chat-engine.config";

/** RNX-283: the empty peer port: a call_agent attempt calls no agent and no model, and gets the "unavailable" text (RNX-121 fills it). */
export const UNAVAILABLE_PEER_CALL: ChatEnginePeerCall = {
  callPeer: async () => CHAT_ENGINE_PEER_UNAVAILABLE,
};
