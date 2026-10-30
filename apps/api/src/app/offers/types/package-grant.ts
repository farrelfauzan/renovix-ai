/** A grant a package version may carry (RNX-76 B2): API access, or every one of the requested model tiers. */
export type PackageGrant = { readonly feature: "apiAccess" } | { readonly feature: "tier"; readonly requested: readonly string[] };
