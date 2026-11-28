import type { Decimal } from "@prisma/client/runtime/client";

/** RNX-321: one weekly reset run: the allowance every weekly_free wallet's balance is set to, and the week's key. */
export type WeeklyResetPlan = {
  readonly allowance: Decimal;
  readonly idempotencyKey: string;
};
