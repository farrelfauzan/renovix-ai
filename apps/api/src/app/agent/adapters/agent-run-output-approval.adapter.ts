import { ChatEngineOutputApproval } from "../../chat-engine/ports/chat-engine-output-approval.port";
import type { OutputApproval } from "../../chat-engine/types/output-approval";
import { GuardrailService } from "../../guardrail/service/guardrail.service";
import { AGENT_RUN_OUTPUT_BLOCKED_MESSAGE } from "../config/agent-run-output-blocked-message";

/**
 * RNX-25: the agent run's output approval port: the output guardrail once on the answer (RNX-275): blocked gives its
 * sanitized text (or the fixed text), else its content (or the answer unchanged). Tool results are not checked, as
 * before.
 */
export class AgentRunOutputApproval extends ChatEngineOutputApproval {
  constructor(private readonly guardrail: GuardrailService) {
    super();
  }

  /** The output guardrail's verdict on the answer, as the content the run stores and returns. */
  async approveOutput(output: string, runnerUserId: string, agentId: string): Promise<OutputApproval> {
    const check = await this.guardrail.checkOutput(output, runnerUserId, agentId);
    if (check.blocked) return { status: "blocked", content: check.sanitized || AGENT_RUN_OUTPUT_BLOCKED_MESSAGE };
    const content = check.content || output;
    return { status: content === output ? "approved" : "transformed", content };
  }

  /** A tool result passes as it is (the agent run never checked tool results). */
  approveToolResult(content: string): Promise<OutputApproval> {
    return Promise.resolve({ status: "approved", content });
  }
}
