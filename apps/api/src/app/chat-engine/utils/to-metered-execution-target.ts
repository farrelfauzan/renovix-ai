import type { ChatEngineAgent } from "../types/chat-engine-agent";
import type { ChatEngineRequest } from "../types/chat-engine-request";
import type { LinkedAgent } from "../../agent/types/linked-agent";
import type { MeteredExecutionTarget } from "../types/metered-execution-target";

/** RNX-282: whose run is metered: the request's runner pays, for the authorized agent, in its workspace, on its model. RNX-25: with the agents it may call (none by default). */
export function toMeteredExecutionTarget(request: ChatEngineRequest, agent: ChatEngineAgent, linkedAgents: readonly LinkedAgent[] = []): MeteredExecutionTarget {
  return { runnerUserId: request.principal.runnerUserId, agentId: agent.id, workspaceId: agent.workspaceId, model: agent.model, linkedAgents };
}
