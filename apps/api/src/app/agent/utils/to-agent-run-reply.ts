import type { ChatEngineResult } from "../../chat-engine/types/chat-engine-result";
import type { AgentRunReply } from "../types/agent-run-reply";
import type { AgentRunSessionRow } from "../types/agent-run-session-row";
import type { AgentRunTurn } from "../types/agent-run-turn";
import type { McpRunSession } from "../types/mcp-run-session";
import { toRunRefusalException } from "./to-run-refusal-exception";

/**
 * RNX-25: the agent message's reply from its collected run on the chat engine (its session row stored by then): a
 * refusal is thrown (as the run policy's asserts), a decline costs nothing (as before), an answer carries the root
 * agent's tokens (0 after a budget stop), the run's cost (Bug B) and the document its `create_document` call made.
 */
export function toAgentRunReply(result: ChatEngineResult, turn: AgentRunTurn, mcpSession: McpRunSession): AgentRunReply {
  if (result.status === "denied") throw toRunRefusalException(result.reason ?? "not_runnable");
  const { id: runId, sessionId } = turn.run as AgentRunSessionRow;
  const message = { role: "assistant" as const, content: result.content ?? "" };
  if (result.status === "declined") return { runId, sessionId, message, usage: { totalTokens: 0, cost: "0" } };
  const totalTokens = turn.isBudgetStopped ? 0 : turn.totalTokens;
  return { runId, sessionId, message, usage: { totalTokens, cost: turn.totalCost.toFixed() }, document: mcpSession.document };
}
