import type { UsageUser } from "./usage-user";

/** One row of `GET /admin/usage/daily` (RNX-228): token counts and calls of a day, provider, model, tier and workspace or user. */
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
