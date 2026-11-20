import type { PeerCall } from "../types/peer-call";
import type { PeerHop } from "../types/peer-hop";

/** RNX-121b-1: the hop of this call as it ended: the called agent one level below its caller, the calling model call, the task and the result. */
export function toPeerHop(call: PeerCall, ending: Pick<PeerHop, "status" | "answer" | "durationMs" | "children">): PeerHop {
  return { agentId: call.callee.id, depth: call.frame.depth + 1, parentCallId: call.request.parentCallId, task: call.task, ...ending };
}
