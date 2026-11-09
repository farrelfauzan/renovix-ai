import type { Prisma } from "@generated/prisma/client.js";

/**
 * A live channel: not deleted, and not the channel of a deleted workspace (RNX-145); a channel without a workspace is
 * live. PrismaService's default filter adds only `deletedAt: null` to top-level reads of `channels` (the workspace
 * routes still answer "Workspace not found" for a deleted workspace, RNX-125); the channel list and a relation filter
 * (a reminder's channel) name this by hand.
 */
export const LIVE_CHANNEL = {
  deletedAt: null,
  NOT: { workspace: { is: { deletedAt: { not: null } } } },
} satisfies Prisma.ChannelWhereInput;
