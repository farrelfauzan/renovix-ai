import { ConflictException, ForbiddenException, HttpException, NotFoundException } from "@nestjs/common";
import type { ChatEngineRefusal } from "../../chat-engine/types/chat-engine-refusal";

/**
 * RNX-25: the HTTP answer for a run the chat engine's run policy refused, the same as AgentRunPolicyService's asserts
 * give: 404 for an agent the runner may not run, 409 in an archived workspace, 403 without an active subscription.
 */
export function toRunRefusalException(reason: ChatEngineRefusal): HttpException {
  if (reason === "workspace_closed") return new ConflictException("This workspace is archived: no new run can start in it");
  if (reason === "no_subscription") return new ForbiddenException("Active subscription required to use AI Agents.");
  return new NotFoundException("Agent not found");
}
