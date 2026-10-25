import { normalizeEntitlementSnapshot } from "./normalize-entitlement-snapshot";

describe("normalizeEntitlementSnapshot", () => {
  it("provisionally normalizes legacy nulls", () => {
    expect(normalizeEntitlementSnapshot({ maxAgents: null, maxConnectedTools: null, apiAccess: null, collaborationEnabled: null, allowedChannels: null, allowedTiers: null })).toEqual({ maxAgents: 0, maxConnectedTools: 0, apiAccess: false, collaborationEnabled: false, allowedChannels: [], allowedTiers: [] });
  });
});
