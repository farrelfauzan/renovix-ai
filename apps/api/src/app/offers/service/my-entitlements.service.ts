import { Injectable } from "@nestjs/common";
import { AgentRepository } from "../../agent/repository/agent.repository";
import { PackageRepository } from "../repository/package.repository";
import type { MyEntitlements } from "../types/my-entitlements";
import { toAllowedTiers } from "../utils/to-allowed-tiers";
import { EntitlementService } from "./entitlement.service";

/** The signed-in user's limits for the UI (RNX-76 B3b): three queries, whatever the number of packages. */
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
    const [next] = await this.packages.findNextListedAfter(entitlement?.displayOrder ?? null, "maxAgents", limit, new Date());
    return {
      packageName: entitlement?.packageName ?? null,
      agents: { used, limit },
      connectedToolsPerAgent: entitlement?.maxConnectedTools ?? 0,
      apiAccess: entitlement?.apiAccess ?? false,
      channels: entitlement?.allowedChannels ?? [],
      tiers: toAllowedTiers(entitlement?.allowedTiers ?? []),
      collaborationEnabled: entitlement?.collaborationEnabled ?? false,
      nextPackage: next?.name ?? null,
    };
  }
}
