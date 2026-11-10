import type { RunDecision } from "../../agent/types/run-decision";
import type { RunScope } from "../../agent/types/run-scope";
import type { ChatEngineAgent } from "./chat-engine-agent";

/** The run policy's decision with the agent it was taken for: allowed in a scope, or refused with the policy's reason. */
export type ChatEngineAuthorization =
  | { readonly allowed: true; readonly agent: ChatEngineAgent; readonly scope: RunScope }
  | Extract<RunDecision, { allowed: false }>;
