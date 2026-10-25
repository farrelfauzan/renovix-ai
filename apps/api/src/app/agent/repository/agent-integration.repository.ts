import { Injectable } from "@nestjs/common";
import type { Prisma } from "@generated/prisma/client.js";
import type { DbTransaction } from "../../prisma/db-transaction";
import { PrismaService } from "../../prisma/prisma.service";

/** The queries on `agent_integrations` (RX-133). Every method takes the transaction as its optional last argument. */
@Injectable()
export class AgentIntegrationRepository {
  constructor(private readonly prisma: PrismaService) {}

  /** Uses the same account lock as agent creation for account-scoped tool limits. */
  acquireAccountEntitlementLock(userId: string, tx: DbTransaction) {
    return tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext('rnx76-entitlements:' || ${userId}))::text`;
  }

  /** This agent's integration with this id, if there is one. */
  findAgentIntegration(
    integrationId: string,
    agentId: string,
    tx?: DbTransaction,
  ) {
    return (tx ?? this.prisma).agentIntegration.findFirst({
      where: { id: integrationId, agentId },
    });
  }

  /** How many integrations this agent has. */
  countAgentIntegrations(agentId: string, tx?: DbTransaction) {
    return (tx ?? this.prisma).agentIntegration.count({
      where: { agentId },
    });
  }

  /** Adds an integration to this agent. */
  createAgentIntegration(
    agentId: string,
    data: Omit<Prisma.AgentIntegrationUncheckedCreateInput, "agentId">,
    tx?: DbTransaction,
  ) {
    return (tx ?? this.prisma).agentIntegration.create({
      data: { agentId, ...data },
    });
  }

  /** Deletes the integration with this id. */
  deleteAgentIntegration(integrationId: string, tx?: DbTransaction) {
    return (tx ?? this.prisma).agentIntegration.delete({
      where: { id: integrationId },
    });
  }
}
