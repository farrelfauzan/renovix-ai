import type { ChatEngineAgent } from "../types/chat-engine-agent";
import type { ChatEngineRequest } from "../types/chat-engine-request";
import type { MeteredExecutionTarget } from "../types/metered-execution-target";

/** RNX-282: whose run is metered: the request's runner pays, for the authorized agent, in its workspace, on its model. */
export function toMeteredExecutionTarget(request: ChatEngineRequest, agent: ChatEngineAgent): MeteredExecutionTarget {
  return { runnerUserId: request.principal.runnerUserId, agentId: agent.id, workspaceId: agent.workspaceId, model: agent.model };
}
