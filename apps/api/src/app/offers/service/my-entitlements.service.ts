import { Injectable } from "@nestjs/common";
import { MODEL_TIERS } from "../config/model-tiers";
import { AgentRepository } from "../../agent/repository/agent.repository";
import { PackageRepository } from "../repository/package.repository";
import type { Entitlement } from "../types/entitlement";
import type { LockedTier } from "../types/locked-tier";
import type { MyEntitlements } from "../types/my-entitlements";
import type { PackageGrant } from "../types/package-grant";
import { toAllowedTiers } from "../utils/to-allowed-tiers";
import { EntitlementService } from "./entitlement.service";

/**
 * The signed-in user's limits for the UI (RNX-76 B3b): three queries, plus one per locked tier (at most three) and one when
 * API access is missing (Q5), whatever the number of packages.
 */
@Injectable()
export class MyEntitlementsService {
  constructor(
    private readonly entitlements: EntitlementService,
    private readonly packages: PackageRepository,
    private readonly agents: AgentRepository,
  ) {}

  /** The user's aggregated package limits, agents used, allowed tiers and the next listed package with more agents; a user without a package gets zero limits. */
  async getForUser(userId: string): Promise<MyEntitlements> {
    const entitlement = await this.entitlements.getForUser(userId);
    const used = await this.agents.countAgentsByUser(userId);
    const limit = entitlement?.maxAgents ?? 0;
    const now = new Date();
    const [next] = await this.packages.findNextListedAfter(entitlement?.displayOrder ?? null, "maxAgents", limit, now);
    const tiers = toAllowedTiers(entitlement?.allowedTiers ?? []);
    const lockedTiers = await this.findLockedTiers(entitlement, tiers, now);
    const apiAccessNextPackage = entitlement?.apiAccess ? null : await this.findGrantingPackage(entitlement, { feature: "apiAccess" }, now);
    return {
      packageName: entitlement?.packageName ?? null,
      agents: { used, limit },
      connectedToolsPerAgent: entitlement?.maxConnectedTools ?? 0,
      apiAccess: entitlement?.apiAccess ?? false,
      channels: entitlement?.allowedChannels ?? [],
      tiers,
      collaborationEnabled: entitlement?.collaborationEnabled ?? false,
      nextPackage: next?.name ?? null,
      lockedTiers,
      apiAccessNextPackage,
    };
  }

  /** Each tier outside `allowed`, in tier order, with the next listed package whose current version grants it; sequential, one pool connection. */
  private async findLockedTiers(entitlement: Entitlement | null, allowed: readonly string[], now: Date): Promise<LockedTier[]> {
    const lockedTiers: LockedTier[] = [];
    for (const tier of MODEL_TIERS.filter((candidate) => !allowed.includes(candidate))) {
      lockedTiers.push({ tier, nextPackage: await this.findGrantingPackage(entitlement, { feature: "tier", requested: [tier] }, now) });
    }
    return lockedTiers;
  }

  /** The name of the next listed package after the user's packages that grants `grant`, or null. */
  private async findGrantingPackage(entitlement: Entitlement | null, grant: PackageGrant, now: Date): Promise<string | null> {
    const [next] = await this.packages.findNextListedGranting(entitlement?.displayOrder ?? null, grant, now);
    return next?.name ?? null;
  }
}
