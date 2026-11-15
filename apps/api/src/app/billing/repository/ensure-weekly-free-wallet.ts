import type { DbTransaction } from "../../prisma/db-transaction";

/**
 * RNX-58a: creates the user's weekly_free wallet with balance 0 when there is none (RNX-321's weekly reset fills it).
 * Idempotent and race-safe: one INSERT ... ON CONFLICT DO NOTHING on the unique (user_id, wallet), so concurrent calls
 * on several instances create one row. A plain function on any client, so the Better Auth sign-up hook (lib/auth.ts,
 * its own PrismaClient) can call it. Sign-up is the only path that creates a user (D190: nothing is deployed, so there
 * are no earlier accounts to backfill); a user without the wallet has 0 weekly_free credits (CreditService.reserve).
 */
export async function ensureWeeklyFreeWallet(db: DbTransaction, userId: string): Promise<void> {
  await db.$executeRaw`
    INSERT INTO "credit_accounts" ("id", "user_id", "wallet", "updated_at")
    VALUES (gen_random_uuid()::text, ${userId}, 'weekly_free'::"CreditWallet", now())
    ON CONFLICT DO NOTHING`;
}
