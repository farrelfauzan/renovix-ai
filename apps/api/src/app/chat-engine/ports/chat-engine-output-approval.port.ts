import type { OutputApproval } from "../types/output-approval";

/** RNX-281: the output approval, injected (the output guardrail is a later ticket). It sees the raw text; its answer is the only content the engine uses. */
export abstract class ChatEngineOutputApproval {
  /** Approves, transforms or blocks the model's answer for this runner and agent. */
  abstract approveOutput(output: string, runnerUserId: string, agentId: string): Promise<OutputApproval>;

  /** Approves, transforms or blocks one tool result's content. */
  abstract approveToolResult(content: string, runnerUserId: string, agentId: string): Promise<OutputApproval>;
}
