import type { Prisma } from "@generated/prisma/client.js";

/**
 * A live channel: not deleted (RNX-145). PrismaService's default filter adds this to top-level reads of `channels`;
 * a relation filter (a reminder's channel) names it by hand.
 */
export const LIVE_CHANNEL = { deletedAt: null } satisfies Prisma.ChannelWhereInput;
