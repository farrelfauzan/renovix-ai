/** The refusal body the API sends when a package does not allow an action (RNX-76). */
type PackageLimitBody = {
  readonly error?: {
    readonly type?: unknown;
    readonly feature?: unknown;
    readonly used?: unknown;
    readonly limit?: unknown;
    readonly requested?: unknown;
    readonly nextPackage?: unknown;
  };
};

const UPGRADE_FALLBACK = "Contact us to raise your limits.";

/**
 * Turns a PACKAGE_LIMIT_REACHED body into one English sentence naming what was refused and the next package.
 * Returns null for any other body.
 */
export function getPackageLimitMessage(body: unknown): string | null {
  const details = (body as PackageLimitBody | null | undefined)?.error;
  if (!details || details.type !== "PACKAGE_LIMIT_REACHED") return null;
  const next = typeof details.nextPackage === "string" ? details.nextPackage : null;
  const close = (reason: string): string => (next ? `Upgrade to ${next} ${reason}` : UPGRADE_FALLBACK);
  switch (details.feature) {
    case "maxAgents":
      return `You've used all ${details.limit} agents in your package. ${close("for more.")}`;
    case "maxConnectedTools":
      return `This agent already has ${details.limit} connected tools, the most your package allows. ${close("for more.")}`;
    case "apiAccess":
      return `API keys aren't included in your package. ${close("to use the API.")}`;
    case "tier": {
      const tiers = Array.isArray(details.requested) ? details.requested.join(", ") : "These";
      return `${tiers} models aren't included in your package. ${close("to use them.")}`;
    }
    case "channel":
      return `This channel isn't included in your package. ${close("to deploy here.")}`;
    case "collaboration":
      return `Inviting members needs a package with collaboration. ${close("to work as a team.")}`;
    default:
      return null;
  }
}
