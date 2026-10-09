import {
  Injectable,
  ForbiddenException,
  BadRequestException,
} from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";

@Injectable()
export class WorkspaceQuotaService {
  constructor(private readonly prisma: PrismaService) {}

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

  async getMaxUsers(workspaceOwnerId: string): Promise<number> {
    const plan = await this.getActivePlan(workspaceOwnerId);
    return plan ? plan.maxWorkspaceUsers : 0;
  }

  /**
   * Collaboration (members, invites, shared access) is Enterprise only (D64):
   * the workspace owner's active plan must be "enterprise". The one place this
   * is decided; RX-76 replaces it with an entitlement.
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
    const plan = await this.getActivePlan(workspace.ownerId);
    return plan?.slug === "enterprise";
  }

  async enforceCollaboration(workspaceId: string, userId?: string) {
    if (!(await this.isCollaborationAllowed(workspaceId, userId))) {
      throw new ForbiddenException(
        "Workspace collaboration requires an Enterprise plan.",
      );
    }
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
