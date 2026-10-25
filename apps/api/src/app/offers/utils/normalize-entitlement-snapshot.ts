export type EntitlementSnapshotValues = {
  maxAgents: number | null;
  maxConnectedTools: number | null;
  apiAccess: boolean | null;
  collaborationEnabled: boolean | null;
  allowedChannels: string[] | null;
  allowedTiers: string[] | null;
};

/** Provisional legacy normalization: nulls become zero/false/empty until policy is decided. */
export const normalizeEntitlementSnapshot = (values: EntitlementSnapshotValues) => ({
  maxAgents: values.maxAgents ?? 0,
  maxConnectedTools: values.maxConnectedTools ?? 0,
  apiAccess: values.apiAccess ?? false,
  collaborationEnabled: values.collaborationEnabled ?? false,
  allowedChannels: values.allowedChannels ?? [],
  allowedTiers: values.allowedTiers ?? [],
});
