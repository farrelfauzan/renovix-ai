import type { Prisma } from "@generated/prisma/client.js";

/**
 * One row of the back-office user list (RNX-357), raw: the name is masked before it leaves the API, and the email is
 * not read (every user has one, so it is always shown masked).
 * `creditsAvailable` is the paid wallet's balance minus held credits (0 without a paid wallet, RNX-358).
 * `status` is "suspended", "locked" (the paid wallet's available credits at or below 0, or no paid wallet) or "active".
 */
export type AdminUserListRow = {
  readonly id: string;
  readonly name: string | null;
  readonly lastLoginAt: Date | null;
  readonly packageId: string | null;
  readonly packageName: string | null;
  readonly creditsAvailable: Prisma.Decimal;
  readonly status: string;
};
