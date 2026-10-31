import type { LockedTier } from "./locked-tier";

/** The signed-in user's package limits as the UI limit pills show them (RNX-76 B3b, Q4). */
export type MyEntitlements = {
  readonly packageName: string | null;
  readonly agents: { readonly used: number; readonly limit: number };
  readonly connectedToolsPerAgent: number;
  readonly apiAccess: boolean;
  readonly channels: readonly string[];
  readonly tiers: readonly string[];
  readonly collaborationEnabled: boolean;
  /** The next listed package with more agents. */
  readonly nextPackage: string | null;
  /** Each tier the packages do not allow, in tier order, with the next listed package granting that tier. */
  readonly lockedTiers: readonly LockedTier[];
  /** The next listed package granting API access; null when the user has it or no listed package grants it. */
  readonly apiAccessNextPackage: string | null;
};
