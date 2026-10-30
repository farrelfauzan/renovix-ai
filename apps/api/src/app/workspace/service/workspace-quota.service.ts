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

  async requireSubscription(userId: string) {
    const subscription = await this.prisma.userSubscription.findUnique({
      where: { userId },
      include: { plan: true },
    });

    if (!subscription || subscription.status !== "active") {
      throw new ForbiddenException(
        "Active AI Agent subscription required. Please upgrade to access workspaces.",
      );
    }

    return subscription;
  }

  private async getActivePlan(workspaceOwnerId: string) {
    const subscription = await this.prisma.userSubscription.findUnique({
      where: { userId: workspaceOwnerId },
      include: { plan: true },
    });

    if (!subscription || subscription.status !== "active") {
      return null;
    }

    return subscription.plan;
  }

  /**
   * The owner's seats: their active plan's maxWorkspaceUsers; without a plan, ENTERPRISE_WORKSPACE_SEATS when one of
   * their packages enables collaboration (RNX-76 B3, D297); otherwise none.
   */
  async getMaxUsers(workspaceOwnerId: string): Promise<number> {
    const plan = await this.getActivePlan(workspaceOwnerId);
    if (plan) return plan.maxWorkspaceUsers;
    return (await this.hasCollaboratingPackage(workspaceOwnerId)) ? ENTERPRISE_WORKSPACE_SEATS : 0;
  }

  /**
   * Collaboration (members, invites, shared access) is Enterprise only (D64).
   * RNX-76 B3 (D44, D297): one of the workspace owner's package snapshots must
   * enable it; a user_subscriptions plan no longer decides it. The one place
   * this is decided.
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
