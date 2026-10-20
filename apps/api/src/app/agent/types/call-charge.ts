import type { Decimal } from "@prisma/client/runtime/client";

/** What one metered call cost (the credits its usage entry charged) and how long it took, for its usage row. */
export type CallCharge = {
  readonly cost: Decimal;
  readonly latencyMs: number;
};
