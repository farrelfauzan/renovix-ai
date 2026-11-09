import type { Prisma } from "@generated/prisma/client.js";

/**
 * A live knowledge base: not deleted (RNX-145). PrismaService's default filter adds this to top-level reads of
 * `knowledge_bases`; a relation filter or a nested read (an agent's knowledge base links) names it by hand.
 */
export const LIVE_KNOWLEDGE_BASE = { deletedAt: null } satisfies Prisma.KnowledgeBaseWhereInput;
