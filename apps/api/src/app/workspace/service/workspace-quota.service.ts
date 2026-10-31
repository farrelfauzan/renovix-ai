import {
  Injectable,
  ForbiddenException,
  BadRequestException,
} from "@nestjs/common";
import { PrismaService } from "../../prisma/prisma.service";
import { EntitlementService } from "../../offers/service/entitlement.service";
import { ENTERPRISE_WORKSPACE_SEATS } from "../config/enterprise-workspace-seats";

@Injectable()
export class WorkspaceQuotaService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly entitlements: EntitlementService,
  ) {}

  /**
   * RNX-251: creating a workspace needs a package (a purchase snapshot, bought or granted by a code, read through
   * EntitlementService); 403 without one. The message is the one the old subscription gate gave.
   */
  async requirePackage(userId: string): Promise<void> {
    if (await this.entitlements.getForUser(userId)) return;
    throw new ForbiddenException(
      "Active AI Agent subscription required. Please upgrade to access workspaces.",
    );
  }

  /**
   * The owner's seats (RNX-76 B3, D297; RNX-251): ENTERPRISE_WORKSPACE_SEATS when one of their packages enables
   * collaboration; otherwise none.
   */
  async getMaxUsers(workspaceOwnerId: string): Promise<number> {
    return (await this.hasCollaboratingPackage(workspaceOwnerId)) ? ENTERPRISE_WORKSPACE_SEATS : 0;
  }

  /**
   * Collaboration (members, invites, shared access) is Enterprise only (D64).
   * RNX-76 B3 (D44, D297): one of the workspace owner's package snapshots must
   * enable it. The one place this is decided.
   * With `userId`, the workspace owner (by `ownerId`, not by member role)
   * always passes: the owner keeps full use of their own workspace.
   */
  async isCollaborationAllowed(
    workspaceId: string,
    userId?: string,
  ): Promise<boolean> {
    const workspace = await this.prisma.workspace.findUniqueOrThrow({
      where: { id: workspaceId },
      select: { ownerId: true },
    });
    if (userId && workspace.ownerId === userId) return true;
    return this.hasCollaboratingPackage(workspace.ownerId);
  }

  /**
   * RNX-76 B3 (Q1): an owner action that adds a member (invite create, invite resend, member reactivation) is
   * refused with 400 PACKAGE_LIMIT_REACHED (feature "collaboration", nextPackage) unless the workspace OWNER's
   * packages enable collaboration, whoever calls.
   */
  async requireOwnerCollaboration(workspaceId: string): Promise<void> {
    const workspace = await this.prisma.workspace.findUniqueOrThrow({
      where: { id: workspaceId },
      select: { ownerId: true },
    });
    await this.entitlements.requireCollaboration(workspace.ownerId);
  }

  async enforceCollaboration(workspaceId: string, userId?: string) {
    if (!(await this.isCollaborationAllowed(workspaceId, userId))) {
      throw new ForbiddenException(
        "Workspace collaboration requires an Enterprise plan.",
      );
    }
  }

  private async hasCollaboratingPackage(ownerId: string): Promise<boolean> {
    return (await this.entitlements.getForUser(ownerId))?.collaborationEnabled ?? false;
  }

  async getActiveCount(workspaceId: string): Promise<number> {
    return this.prisma.workspaceMember.count({
      where: { workspaceId, status: "active" },
    });
  }

  async getQuota(workspaceId: string) {
    const workspace = await this.prisma.workspace.findUniqueOrThrow({
      where: { id: workspaceId },
    });

    const maxUsers = await this.getMaxUsers(workspace.ownerId);
    const activeCount = await this.getActiveCount(workspaceId);

    return {
      maxUsers,
      activeCount,
      available: maxUsers - activeCount,
    };
  }

  async enforceCanAddMember(workspaceId: string) {
    const { maxUsers, activeCount } = await this.getQuota(workspaceId);

    if (activeCount >= maxUsers) {
      throw new BadRequestException(
        `Workspace has reached its seat limit (${maxUsers}). Upgrade your subscription to add more members.`,
      );
    }
  }
}
