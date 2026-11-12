import { Decimal } from "@prisma/client/runtime/client";
import type { AgentRunTurn } from "../types/agent-run-turn";

/** RNX-25: a new turn for one agent message: nothing stored, counted or stopped yet (the cost starts at 0 credits). */
export function createAgentRunTurn(identity: Pick<AgentRunTurn, "agentId" | "userId" | "sessionId" | "message" | "scope">): AgentRunTurn {
  return { ...identity, run: null, totalTokens: 0, totalCost: new Decimal(0), isBudgetStopped: false };
}
