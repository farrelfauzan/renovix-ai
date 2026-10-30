/** The signed-in user's package limits as the UI limit pills show them (RNX-76 B3b, Q4). */
export type MyEntitlements = {
  readonly packageName: string | null;
  readonly agents: { readonly used: number; readonly limit: number };
  readonly connectedToolsPerAgent: number;
  readonly apiAccess: boolean;
  readonly channels: readonly string[];
  readonly tiers: readonly string[];
  readonly collaborationEnabled: boolean;
  readonly nextPackage: string | null;
};
