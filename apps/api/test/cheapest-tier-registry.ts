import { MODEL_TIERS } from "../src/app/offers/config/model-tiers";

/**
 * RNX-76 B2b: a ModelRegistryService stand-in for agent specs that call no model. Every slug resolves to a model of
 * the cheapest tier, which every account keeps (Q1), so agent create, model update and clone pass the tier gate.
 */
export const cheapestTierRegistry = {
  resolveModel: async (slug: string): Promise<{ slug: string; tier: string }> => ({ slug, tier: MODEL_TIERS[0] }),
};
