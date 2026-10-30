/**
 * The details of a PACKAGE_LIMIT_REACHED refusal (RNX-76): which package feature refused, the next listed package that
 * would grant it, and, by feature, the numeric usage and limit (maxAgents, maxConnectedTools) or what was asked for.
 */
export type PackageLimitDetails = {
  readonly feature: "maxAgents" | "maxConnectedTools" | "apiAccess" | "tier" | "channel";
  readonly nextPackage: string | null;
  readonly used?: number;
  readonly limit?: number;
  readonly requested?: readonly string[];
};
