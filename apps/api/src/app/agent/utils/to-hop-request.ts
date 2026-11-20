import type { ChatEngineRequest } from "../../chat-engine/types/chat-engine-request";
import type { CallableAgent } from "../types/callable-agent";
import type { PeerCall } from "../types/peer-call";

/**
 * RNX-121b-1: the engine request of a called agent's run, the `agent-run` source: the run's runner, the called agent
 * with no history (only its input), all of its own tools (MCP tools included) and call_agent when it may call agents.
 */
export function toHopRequest(call: PeerCall, callableAgents: readonly CallableAgent[]): ChatEngineRequest {
  return {
    principal: { runnerUserId: call.frame.state.runnerUserId },
    source: "agent-run",
    conversation: { agentId: call.callee.id, history: [] },
    input: call.task,
    options: { offeredTools: [], offersCallAgent: callableAgents.length > 0, offersAgentTools: true },
  };
}
