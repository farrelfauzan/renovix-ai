import { Injectable } from "@nestjs/common";
import type { UserMcpCredential } from "@generated/prisma/client.js";
import type { DbTransaction } from "../../prisma/db-transaction";
import { PrismaService } from "../../prisma/prisma.service";
import type { UpsertUserMcpCredentialInput } from "../types/upsert-user-mcp-credential-input";
import type { UserMcpCredentialKey } from "../types/user-mcp-credential-key";
import type { WorkspaceMcpCredentialKey } from "../types/workspace-mcp-credential-key";

/**
 * The queries on `user_mcp_credentials` (RNX-140): each user's encrypted MCP tool credentials. RNX-292 (D312): one
 * per account and provider, used in a workspace only where a `workspace_mcp_connections` row switches it on. The
 * writes by id (`deleteCredential`, `updateCredentialStatus`) take no user: the service finds the row by its user
 * first, as before.
 */
@Injectable()
export class UserMcpCredentialRepository {
  constructor(private readonly prisma: PrismaService) {}

  /** Stores the credential of this user and provider, or replaces its env: status connected, connected now. */
  upsertCredential(input: UpsertUserMcpCredentialInput, tx?: DbTransaction): Promise<UserMcpCredential> {
    const { userId, provider, envEncrypted } = input;
    return (tx ?? this.prisma).userMcpCredential.upsert({
      where: {
        userId_provider: { userId, provider },
      },
      create: {
        userId,
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

  /** This user's credentials switched on in this workspace, without their env, the most recently connected first. */
  listCredentialSummaries(userId: string, workspaceId: string, tx?: DbTransaction) {
    return (tx ?? this.prisma).userMcpCredential.findMany({
      where: { userId, workspaceConnections: { some: { workspaceId } } },
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

  /**
   * RNX-292: this user's account credentials without their env, the most recently connected first, each with the
   * workspaces it is switched on in.
   */
  listAccountCredentialSummaries(userId: string, tx?: DbTransaction) {
    return (tx ?? this.prisma).userMcpCredential.findMany({
      where: { userId },
      select: {
        id: true,
        provider: true,
        status: true,
        connectedAt: true,
        expiresAt: true,
        workspaceConnections: { select: { workspaceId: true }, orderBy: { enabledAt: "asc" } },
      },
      orderBy: { connectedAt: "desc" },
    });
  }

  /** This user's credentials without their env, the most recently connected first. */
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

  /** The credential of this user and provider, whatever its status. */
  findCredential(key: UserMcpCredentialKey, tx?: DbTransaction): Promise<UserMcpCredential | null> {
    const { userId, provider } = key;
    return (tx ?? this.prisma).userMcpCredential.findUnique({
      where: {
        userId_provider: { userId, provider },
      },
    });
  }

  /** RNX-292: the connected credential of this user and provider, only if it is switched on in this workspace (one query). */
  findSwitchedOnCredential(key: WorkspaceMcpCredentialKey, tx?: DbTransaction): Promise<UserMcpCredential | null> {
    const { userId, workspaceId, provider } = key;
    return (tx ?? this.prisma).userMcpCredential.findFirst({
      where: { userId, provider, status: "connected", workspaceConnections: { some: { workspaceId } } },
    });
  }

  /** The credential with this id if it belongs to this user. */
  findUserCredential(id: string, userId: string, tx?: DbTransaction): Promise<UserMcpCredential | null> {
    return (tx ?? this.prisma).userMcpCredential.findFirst({
      where: { id, userId },
    });
  }

  /** This user's connected credentials switched on in this workspace (RNX-292; one query). */
  listConnectedCredentials(userId: string, workspaceId: string, tx?: DbTransaction): Promise<UserMcpCredential[]> {
    return (tx ?? this.prisma).userMcpCredential.findMany({
      where: { userId, status: "connected", workspaceConnections: { some: { workspaceId } } },
    });
  }

  /** Sets the status of the credential with this id. */
  updateCredentialStatus(id: string, status: string, tx?: DbTransaction): Promise<UserMcpCredential> {
    return (tx ?? this.prisma).userMcpCredential.update({
      where: { id },
      data: { status },
    });
  }

  /** Deletes the credential with this id; its workspace switches go with it (cascade, RNX-292). */
  deleteCredential(id: string, tx?: DbTransaction): Promise<UserMcpCredential> {
    return (tx ?? this.prisma).userMcpCredential.delete({
      where: { id },
    });
  }
}
