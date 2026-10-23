import type { Prisma } from "@generated/prisma/client.js";

/**
 * An API key as the list and the create route answer with it (RNX-18): never the hash or the plaintext. RNX-232: its
 * allowed model tiers and its monthly credit cap (null: no cap).
 */
export interface ApiKeyView {
  readonly id: string;
  readonly name: string;
  readonly prefix: string;
  readonly createdAt: Date;
  readonly lastUsedAt: Date | null;
  readonly revokedAt: Date | null;
  readonly expiresAt: Date | null;
  readonly allowedTiers: string[];
  readonly monthlyCreditCap: Prisma.Decimal | null;
}
