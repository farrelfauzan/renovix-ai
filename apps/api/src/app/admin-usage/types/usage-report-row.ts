import type { UsageUser } from "./usage-user";

/**
 * Token counts and calls of one day, provider record, model, tier and workspace or user (RNX-228, usage:read): no cost and
 * no revenue. `providerId` is "no provider record" for the calls without one. `user` is set when the calls have no
 * workspace (the usage entry's runner).
 */
export type UsageReportRow = {
  readonly day: string;
  readonly providerId: string;
  readonly providerModelId: string;
  readonly tier: string;
  readonly workspaceId: string | null;
  readonly user: UsageUser | null;
  readonly calls: number;
  readonly tokensNew: string;
  readonly tokensCached: string;
  readonly tokensOut: string;
  readonly tokensReasoning: string;
};
