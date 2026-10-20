import type { Prisma } from "@generated/prisma/client.js";

/**
 * The one hold of an agent run on the runner's paid wallet (docs/credits.md section 13.3): H = min(cap, available),
 * placed only when available >= `minimum` (min(E_run, cap)). The run's id is also its request id. Whole micro-credits.
 */
export type RunReserveRequest = {
  readonly userId: string;
  readonly runId: string;
  readonly cap: Prisma.Decimal;
  readonly minimum: Prisma.Decimal;
};
