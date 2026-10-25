export type EntitlementSnapshotValues = {
  maxAgents: number | null;
  maxConnectedTools: number | null;
  apiAccess: boolean | null;
  collaborationEnabled: boolean | null;
  allowedChannels: string[] | null;
  allowedTiers: string[] | null;
};

/** Legacy nulls contribute no grant: all-null aggregates become zero/false/empty. */
export const normalizeEntitlementSnapshot = (values: EntitlementSnapshotValues) => ({
  maxAgents: values.maxAgents ?? 0,
  maxConnectedTools: values.maxConnectedTools ?? 0,
  apiAccess: values.apiAccess ?? false,
  collaborationEnabled: values.collaborationEnabled ?? false,
  allowedChannels: values.allowedChannels ?? [],
  allowedTiers: values.allowedTiers ?? [],
});
