import type { ChatHopEvent } from "../../chat-engine/types/chat-hop-event";
import type { ChildRunStatus } from "../types/child-run-status";
import type { PeerCall } from "../types/peer-call";

/** RNX-328: the event of this call's hop: its start, or its end with the status its child row records. */
export function toHopEvent(call: PeerCall, status?: ChildRunStatus): ChatHopEvent {
  const hop = { agentId: call.callee.id, agentName: call.callee.name, depth: call.frame.depth + 1 };
  return status ? { type: "hop_end", ...hop, status } : { type: "hop_start", ...hop };
}
