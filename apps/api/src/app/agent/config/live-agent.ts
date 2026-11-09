import type { Prisma } from "@generated/prisma/client.js";

/**
 * A live agent: not deleted (RNX-124) and not in a deleted workspace (RNX-125). PrismaService's default filter adds
 * this to top-level reads of `agents`; a relation filter, a nested read or a `_count` names it by hand with this value.
 */
export const LIVE_AGENT = { deletedAt: null, workspace: { deletedAt: null } } satisfies Prisma.AgentWhereInput;
