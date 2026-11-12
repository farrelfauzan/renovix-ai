import {
  Injectable,
  NotFoundException,
  ForbiddenException,
} from "@nestjs/common";
import { WorkspaceRepository } from "../repository/workspace.repository";
import { WorkspaceMemberRepository } from "../repository/workspace-member.repository";
import type { CreateWorkspaceDto } from "../dto/create-workspace.dto";
import type { UpdateWorkspaceDto } from "../dto/update-workspace.dto";
import { WorkspaceQuotaService } from "./workspace-quota.service";
import { slugify } from "../../../common/utils/slugify";
import { withPurgeAt } from "../../../common/utils/with-purge-at";
import { DELETED_LIST_LIMIT } from "../../../common/config/deleted-list-limit";
import { AgentRepository } from "../../agent/repository/agent.repository";
import { EntitlementService } from "../../offers/service/entitlement.service";
import { TransactionService } from "../../prisma/transaction.service";
import { ChannelRepository } from "../../channel/repository/channel.repository";
import { CHANNEL_WORKSPACE_SLUG_LENGTH } from "../config/channel-workspace-slug-length";
import { WorkspaceMcpConnectionRepository } from "../../mcp/repository/workspace-mcp-connection.repository";

@Injectable()
export class WorkspaceService {
  constructor(
    private readonly quotaService: WorkspaceQuotaService,
    private readonly workspaces: WorkspaceRepository,
    private readonly workspaceMembers: WorkspaceMemberRepository,
    private readonly agents: AgentRepository,
    private readonly entitlements: EntitlementService,
    private readonly transactions: TransactionService,
    private readonly channels: ChannelRepository,
    private readonly mcpConnections: WorkspaceMcpConnectionRepository,
  ) {}

  private async generateUniqueSlug(
    ownerId: string,
    name: string,
  ): Promise<string> {
    const baseSlug = slugify(name);
    let slug = baseSlug;
    let counter = 1;

    while (true) {
      const existing = await this.workspaces.findOwnerWorkspaceBySlug(ownerId, slug);
      if (!existing) return slug;
      slug = `${baseSlug}-${counter}`;
      counter++;
    }
  }

  async create(userId: string, dto: CreateWorkspaceDto) {
    // RNX-251: verify the user has a package (a purchase snapshot)
    await this.quotaService.requirePackage(userId);

    const slug = await this.generateUniqueSlug(userId, dto.name);

    const workspace = await this.workspaces.createWorkspace(userId, {
      name: dto.name,
      slug,
      description: dto.description,
      avatar: dto.avatar,
    });

    // Auto-create owner as first member
    await this.workspaceMembers.createOwnerMember(workspace.id, userId);

    return workspace;
  }

  /**
   * The workspace of a channel (POST /channels/:channelId/workspace): its owner creates it, with their active owner
   * member row; an existing one is returned as it is. 404 "Server not found" for a missing or deleted channel, 404
   * "Workspace not found" when its workspace is deleted (RNX-125: channel_id stays taken), 403 for anyone else.
   * RNX-295: in one transaction under the channel's row lock, which the channel's delete takes too, so a channel
   * deleted meanwhile is seen here (404) and never gets a live workspace.
   */
  async createChannelWorkspace(channelId: string, userId: string) {
    return this.transactions.run(async (tx) => {
      await this.channels.lockLiveChannel(channelId, tx);
      const channel = await this.channels.findChannelWithWorkspace(channelId, tx);
      if (!channel) throw new NotFoundException("Server not found");
      if (channel.workspace?.deletedAt) throw new NotFoundException("Workspace not found");
      if (channel.userId !== userId) {
        throw new ForbiddenException("Only the server owner can create a workspace");
      }
      if (channel.workspace) return channel.workspace;
      const slug = slugify(channel.name).slice(0, CHANNEL_WORKSPACE_SLUG_LENGTH) || "workspace";
      const workspace = await this.workspaces.createWorkspace(userId, { channelId: channel.id, name: channel.name, slug }, tx);
      await this.workspaceMembers.createOwnerMember(workspace.id, userId, tx);
      return workspace;
    });
  }

  /**
   * A channel and its workspace (null when it has none) for its owner or an active member of its workspace; 404
   * "Server not found" for a missing or deleted channel, 404 "Workspace not found" when its workspace is deleted (a
   * relation read: the default filter does not reach it, RNX-125), 403 for anyone else. Non-owners need a plan that
   * allows collaboration (RX-113, D64).
   */
  async resolveChannelWorkspace(channelId: string, userId: string) {
    const channel = await this.channels.findChannelWithWorkspace(channelId);
    if (!channel) throw new NotFoundException("Server not found");
    if (channel.workspace?.deletedAt) throw new NotFoundException("Workspace not found");
    if (channel.userId !== userId) {
      const member = channel.workspace
        ? await this.workspaceMembers.findMembership(channel.workspace.id, userId)
        : null;
      if (!member || member.status !== "active") {
        throw new ForbiddenException("You do not have access to this server");
      }
    }
    if (channel.workspace && channel.workspace.ownerId !== userId) {
      await this.quotaService.enforceCollaboration(channel.workspace.id);
    }
    return { channel, workspace: channel.workspace };
  }

  /** The active members of this workspace, each with its user's id and email (GET /channels/:channelId/workspace). */
  async listActiveMembers(workspaceId: string) {
    return this.workspaceMembers.listActiveMembersWithUser(workspaceId);
  }

  /** The workspaces this user is an active member of; a default (RNX-117, D219 a) or deleted (RNX-125) one is left out. */
  async list(userId: string) {
    return this.workspaces.listMemberWorkspaces(userId);
  }

  /** The workspace for one of its active members; 404 for a default (RNX-117, D219 a) or deleted (RNX-125) one. */
  async getById(workspaceId: string, userId: string) {
    const workspace = await this.workspaces.findMemberWorkspaceDetail(workspaceId, userId);

    if (!workspace) {
      throw new NotFoundException("Workspace not found");
    }

    if (workspace.ownerId !== userId) {
      await this.quotaService.enforceCollaboration(workspaceId);
    }

    return {
      ...workspace,
      collaborationAllowed: await this.quotaService.isCollaborationAllowed(workspaceId),
      effectiveRole: workspace.ownerId === userId ? "owner" as const : "member" as const,
    };
  }

  async update(workspaceId: string, userId: string, dto: UpdateWorkspaceDto) {
    await this.requireRole(workspaceId, userId, ["owner", "admin"]);

    return this.workspaces.updateWorkspace(workspaceId, {
      ...(dto.name !== undefined && { name: dto.name }),
      ...(dto.description !== undefined && { description: dto.description }),
      ...(dto.avatar !== undefined && { avatar: dto.avatar }),
    });
  }

  /**
   * RNX-125: the owner deletes the workspace (soft delete, by this user): it is gone for everyone, its children stay
   * hidden with it. 403 for anyone else (requireRole), 404 for a default or deleted workspace (requireMembership).
   * RNX-292: its MCP switches go in the same transaction as the marker; the members' account credentials stay.
   */
  async softDelete(workspaceId: string, userId: string) {
    await this.requireRole(workspaceId, userId, ["owner"]);

    return this.transactions.run(async (tx) => {
      const workspace = await this.workspaces.softDeleteWorkspace(workspaceId, userId, tx);
      await this.mcpConnections.deleteWorkspaceConnections(workspaceId, tx);
      return workspace;
    });
  }

  /** RNX-126: the deleted workspaces this user owns, newest-deleted first, each with its purgeAt (a member sees none). */
  async listDeleted(userId: string) {
    const workspaces = await this.workspaces.listDeletedOwnedWorkspaces(userId, DELETED_LIST_LIMIT);
    return workspaces.map(withPurgeAt);
  }

  /**
   * RNX-126: the owner restores a deleted workspace; 404 for anyone else (a member included) or a live one. Only its
   * own marker is cleared: the children hidden with it come back, a child deleted on its own stays deleted. D316: in
   * one transaction under agent create's lock, refused as a whole with create's error when its agents not deleted on
   * their own would take the owner over maxAgents.
   */
  async restore(workspaceId: string, userId: string) {
    return this.transactions.run(async (tx) => {
      const workspace = await this.workspaces.findDeletedOwnedWorkspace(workspaceId, userId, tx);
      if (!workspace) throw new NotFoundException("Workspace not found");
      await this.agents.acquireAccountEntitlementLock(userId, tx);
      const returning = await this.agents.countUndeletedWorkspaceAgents(workspaceId, tx);
      if (returning > 0) {
        const owned = await this.agents.countAgentsByUser(userId, tx);
        // requireLimit refuses `current` at or above the limit, as for one new agent: the last of `returning` is that one
        await this.entitlements.requireLimit(userId, "maxAgents", owned + returning - 1, tx);
      }
      return this.workspaces.restoreWorkspace(workspaceId, userId, tx);
    });
  }

  /**
   * An active member whose workspace role is in `allowedRoles` (403 otherwise). RNX-260 (D259, D81): the role is
   * decided by `workspace.ownerId`, not by the member row: the owner is "owner", everyone else is "member" (a
   * stale "admin" or "viewer" row counts as a collaborator), so an owner-or-admin list means the owner only.
   */
  async requireRole(
    workspaceId: string,
    userId: string,
    allowedRoles: string[],
  ) {
    const member = await this.requireMembership(workspaceId, userId);
    const ownedWorkspace = await this.workspaces.findOwnedWorkspace(workspaceId, userId);

    if (!allowedRoles.includes(ownedWorkspace ? "owner" : "member")) {
      throw new ForbiddenException("Insufficient workspace permissions");
    }

    return member;
  }

  async requireMembership(workspaceId: string, userId: string) {
    // RNX-125: a deleted workspace is hidden (PrismaService default filter): not found for everyone, its owner, its
    // members and its invitees included. Every route that takes a workspace id comes through here (requireRole too).
    const workspace = await this.workspaces.findDefaultFlag(workspaceId);
    if (!workspace) {
      throw new NotFoundException("Workspace not found");
    }

    const member = await this.workspaceMembers.findMembership(workspaceId, userId);

    if (!member || member.status !== "active") {
      throw new ForbiddenException("Not a member of this workspace");
    }

    // RNX-117 (D219 a): the default workspace is hidden from the workspace routes, so its member gets the
    // not-found answer of getById.
    if (workspace.isDefault) {
      throw new NotFoundException("Workspace not found");
    }

    // Everyone but the workspace owner (by ownerId) needs a workspace whose
    // owner's plan allows collaboration (RX-113, D64).
    await this.quotaService.enforceCollaboration(workspaceId, userId);

    return member;
  }
}
