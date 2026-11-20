import { PEER_CALL_MESSAGES } from "../config/peer-call-messages";
import type { PeerCall } from "../types/peer-call";
import type { PeerRunLimits } from "../types/peer-run-limits";

/**
 * RNX-121b-1: why this call may not run, or null: the called agent is already on the call stack (a cycle), its depth
 * would pass the limit, or the run has started as many agent calls as it may.
 */
export function findPeerRefusal(call: PeerCall, limits: PeerRunLimits): string | null {
  const { state, depth } = call.frame;
  if (state.stack.includes(call.callee.id)) return PEER_CALL_MESSAGES.cycle;
  if (depth + 1 > limits.maxDepth) return PEER_CALL_MESSAGES.depthLimit;
  if (state.agentCalls >= limits.maxAgentCalls) return PEER_CALL_MESSAGES.agentCallLimit;
  return null;
}
