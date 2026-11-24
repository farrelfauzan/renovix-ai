import type { ChatEngineAgent } from "../types/chat-engine-agent";
import type { ChatEngineRequest } from "../types/chat-engine-request";
import type { LinkedAgent } from "../../agent/types/linked-agent";
import type { MeteredExecutionTarget } from "../types/metered-execution-target";

/**
 * RNX-282: whose run is metered: the request's runner pays, for the authorized agent, in its workspace, on its model.
 * RNX-25: with the agents it may call (none by default). RNX-24a: a request with a room (the channel chat) is metered
 * in the room's workspace, as before, and (D381, until RNX-351) its linked agents count one call each.
 */
export function toMeteredExecutionTarget(request: ChatEngineRequest, agent: ChatEngineAgent, linkedAgents: readonly LinkedAgent[] = []): MeteredExecutionTarget {
  const { room } = request.conversation;
  const workspaceId = room ? (room.workspaceId ?? undefined) : agent.workspaceId;
  return { runnerUserId: request.principal.runnerUserId, agentId: agent.id, workspaceId, model: agent.model, linkedAgents, countsCalleeToolLoops: request.source !== "channel-chat" };
}
