import type { DbTransaction } from "../../prisma/db-transaction";

/**
 * RNX-100 (D427): whether this user is suspended (false for an unknown user). A plain function on any client, so the
 * Better Auth session hook in lib/auth.ts (its own PrismaClient, outside Nest DI) can refuse a suspended user's sign-in.
 */
export async function isUserSuspended(db: DbTransaction, userId: string): Promise<boolean> {
  const user = await db.user.findUnique({ where: { id: userId }, select: { status: true } });
  return user?.status === "suspended";
}
