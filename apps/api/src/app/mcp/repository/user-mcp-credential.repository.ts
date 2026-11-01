import { Injectable } from "@nestjs/common";
import type { UserMcpCredential } from "@generated/prisma/client.js";
import type { DbTransaction } from "../../prisma/db-transaction";
import { PrismaService } from "../../prisma/prisma.service";
import type { UpsertUserMcpCredentialInput } from "../types/upsert-user-mcp-credential-input";
import type { UserMcpCredentialKey } from "../types/user-mcp-credential-key";

/**
 * The queries on `user_mcp_credentials` (RNX-140): each user's encrypted MCP tool credentials, one per workspace
 * and provider. The writes by id (`deleteCredential`, `updateCredentialStatus`) take no user: the service finds the
 * row by its user first, as before.
 */
@Injectable()
export class UserMcpCredentialRepository {
  constructor(private readonly prisma: PrismaService) {}

  /** Stores the credential of this user, workspace and provider, or replaces its env: status connected, connected now. */
  upsertCredential(input: UpsertUserMcpCredentialInput, tx?: DbTransaction): Promise<UserMcpCredential> {
    const { userId, workspaceId, provider, envEncrypted } = input;
    return (tx ?? this.prisma).userMcpCredential.upsert({
      where: {
        userId_workspaceId_provider: { userId, workspaceId, provider },
      },
      create: {
        userId,
        workspaceId,
        provider,
        envEncrypted,
        status: "connected",
      },
      update: {
        envEncrypted,
        status: "connected",
        connectedAt: new Date(),
      },
    });
  }

  /** This user's credentials of this workspace without their env, the most recently connected first. */
  listCredentialSummaries(userId: string, workspaceId: string, tx?: DbTransaction) {
    return (tx ?? this.prisma).userMcpCredential.findMany({
      where: { userId, workspaceId },
      select: {
        id: true,
        provider: true,
        status: true,
        connectedAt: true,
        expiresAt: true,
      },
      orderBy: { connectedAt: "desc" },
    });
  }

  /** This user's credentials of every workspace without their env, the most recently connected first. */
  listUserCredentialSummaries(userId: string, tx?: DbTransaction) {
    return (tx ?? this.prisma).userMcpCredential.findMany({
      where: { userId },
      select: {
        id: true,
        provider: true,
        status: true,
        connectedAt: true,
      },
      orderBy: { connectedAt: "desc" },
    });
  }

  /** The credential of this user, workspace and provider, whatever its status. */
  findCredential(key: UserMcpCredentialKey, tx?: DbTransaction): Promise<UserMcpCredential | null> {
    const { userId, workspaceId, provider } = key;
    return (tx ?? this.prisma).userMcpCredential.findUnique({
      where: {
        userId_workspaceId_provider: { userId, workspaceId, provider },
      },
    });
  }

  /** The credential with this id if it belongs to this user. */
  findUserCredential(id: string, userId: string, tx?: DbTransaction): Promise<UserMcpCredential | null> {
    return (tx ?? this.prisma).userMcpCredential.findFirst({
      where: { id, userId },
    });
  }

  /** This user's connected credentials of this workspace. */
  listConnectedCredentials(userId: string, workspaceId: string, tx?: DbTransaction): Promise<UserMcpCredential[]> {
    return (tx ?? this.prisma).userMcpCredential.findMany({
      where: { userId, workspaceId, status: "connected" },
    });
  }

  /** Sets the status of the credential with this id. */
  updateCredentialStatus(id: string, status: string, tx?: DbTransaction): Promise<UserMcpCredential> {
    return (tx ?? this.prisma).userMcpCredential.update({
      where: { id },
      data: { status },
    });
  }

  /** Deletes the credential with this id. */
  deleteCredential(id: string, tx?: DbTransaction): Promise<UserMcpCredential> {
    return (tx ?? this.prisma).userMcpCredential.delete({
      where: { id },
    });
  }
}
