import { Injectable } from "@nestjs/common";
import type { WorkspaceMcpConnection } from "@generated/prisma/client.js";
import type { DbTransaction } from "../../prisma/db-transaction";
import { PrismaService } from "../../prisma/prisma.service";

/**
 * The queries on `workspace_mcp_connections` (RNX-292, D312): which account MCP credential is switched on in which
 * workspace. A row goes with its workspace or its credential (cascade); the callers check who may write one.
 */
@Injectable()
export class WorkspaceMcpConnectionRepository {
  constructor(private readonly prisma: PrismaService) {}

  /** Switches the credential with this id on in this workspace; already on, the row stays as it is. */
  switchOn(workspaceId: string, credentialId: string, tx?: DbTransaction): Promise<WorkspaceMcpConnection> {
    return (tx ?? this.prisma).workspaceMcpConnection.upsert({
      where: { workspaceId_credentialId: { workspaceId, credentialId } },
      create: { workspaceId, credentialId },
      update: {},
    });
  }

  /** Switches the credential with this id off in this workspace. Returns how many rows went (0 or 1). */
  async switchOff(workspaceId: string, credentialId: string, tx?: DbTransaction): Promise<number> {
    const { count } = await (tx ?? this.prisma).workspaceMcpConnection.deleteMany({
      where: { workspaceId, credentialId },
    });
    return count;
  }

  /** Removes every switch of this workspace (its delete). Returns how many. */
  async deleteWorkspaceConnections(workspaceId: string, tx?: DbTransaction): Promise<number> {
    const { count } = await (tx ?? this.prisma).workspaceMcpConnection.deleteMany({
      where: { workspaceId },
    });
    return count;
  }

  /** Removes this user's switches in this workspace (the member is removed). Returns how many. */
  async deleteMemberConnections(workspaceId: string, userId: string, tx?: DbTransaction): Promise<number> {
    const { count } = await (tx ?? this.prisma).workspaceMcpConnection.deleteMany({
      where: { workspaceId, credential: { userId } },
    });
    return count;
  }
}
