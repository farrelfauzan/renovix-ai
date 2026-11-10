import { CHAT_ENGINE_LOOP_PROFILES } from "../config/chat-engine-loop-profiles";
import type { ChatEngineLoopProfile } from "../types/chat-engine-loop-profile";
import type { ChatEngineRequest } from "../types/chat-engine-request";

/** RNX-283: the source's tool-loop profile; a source without a tool loop (the portal) is refused before any model call. */
export function loopProfileOf(source: ChatEngineRequest["source"]): ChatEngineLoopProfile {
  const profile = CHAT_ENGINE_LOOP_PROFILES[source];
  if (!profile) throw new Error(`The chat engine has no tool loop for the "${source}" source`);
  return profile;
}
