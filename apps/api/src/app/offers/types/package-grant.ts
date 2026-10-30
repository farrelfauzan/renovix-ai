/**
 * A grant a package version may carry (RNX-76 B2, B3): API access, workspace collaboration (D297), or every one of the
 * requested model tiers or channels.
 */
export type PackageGrant =
  | { readonly feature: "apiAccess" | "collaboration" }
  | { readonly feature: "tier" | "channel"; readonly requested: readonly string[] };
