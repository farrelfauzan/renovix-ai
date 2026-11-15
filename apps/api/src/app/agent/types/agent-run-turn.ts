import type { Decimal } from "@prisma/client/runtime/client";
import type { AgentRunSessionRow } from "./agent-run-session-row";
import type { RunScope } from "./run-scope";

/**
 * RNX-25: one agent message on the chat engine, local to that message (never shared between runs): the agent, the
 * runner, the session id and the raw message (the adapter's own copy, D341 D3), the run's scope, the session row once
 * stored, and what the run's model calls added up to: the root agent's tokens, the charge of every call (root and hop,
 * D341 D5) and whether it stopped at its budget.
 */
export type AgentRunTurn = {
  readonly agentId: string;
  readonly userId: string;
  readonly sessionId: string;
  readonly message: string;
  readonly scope: RunScope;
  run: AgentRunSessionRow | null;
  totalTokens: number;
  totalCost: Decimal;
  isBudgetStopped: boolean;
};
