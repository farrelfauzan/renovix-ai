import type { Workspace } from "@generated/prisma/client.js";
import type { DbTransaction } from "../../prisma/db-transaction";

const DEFAULT_WORKSPACE_NAME = "Personal";
const DEFAULT_WORKSPACE_SLUG = "personal";
const UNIQUE_VIOLATION = "P2002";

/**
 * The owner's default workspace (RNX-117), created with its owner member row when there is none yet.
 * Idempotent and race-safe: the partial unique index on `workspaces(owner_id) WHERE is_default` lets one
 * creator win; a loser gets P2002 and reads the winner's row. A plain function on any client, so the
 * Better Auth sign-up hook (lib/auth.ts, its own PrismaClient) and WorkspaceRepository share it.
 * Inside an interactive transaction a lost race aborts that transaction, so call it there only when no
 * other creator is possible (a user created in the same transaction).
 */
export async function ensureDefaultWorkspace(
  db: DbTransaction,
  ownerId: string,
): Promise<Workspace> {
  const existing = await db.workspace.findFirst({ where: { ownerId, isDefault: true } });
  if (existing) return existing;
  try {
    return await db.workspace.create({
      data: {
        ownerId,
        name: DEFAULT_WORKSPACE_NAME,
        slug: DEFAULT_WORKSPACE_SLUG,
        isDefault: true,
        members: {
          create: { userId: ownerId, role: "owner", status: "active", joinedAt: new Date() },
        },
      },
    });
  } catch (err) {
    if ((err as { code?: string }).code !== UNIQUE_VIOLATION) throw err;
    return db.workspace.findFirstOrThrow({ where: { ownerId, isDefault: true } });
  }
}
