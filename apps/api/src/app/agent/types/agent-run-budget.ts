import type { Decimal } from "@prisma/client/runtime/client";

/**
 * One agent run on the ledger (docs/credits.md section 13): a new runId per agent message (D202 item 6; not the
 * AgentRun session id), its one reservation, the runner who pays (memberUserId on every usage entry), the hold H and
 * the credits its usage entries charged so far (the budget stop compares spent + E_call with H).
 */
export type AgentRunBudget = {
  readonly runId: string;
  readonly reservationId: string;
  readonly runnerUserId: string;
  readonly held: Decimal;
  spent: Decimal;
};
