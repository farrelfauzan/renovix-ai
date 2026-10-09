import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { WorkspaceQuotaService } from "./workspace-quota.service";
import { EmailJobService } from "../email/email-job.service";
import { createHash, randomBytes } from "crypto";
import type { InviteMemberDto } from "./dto/invite-member.dto";

@Injectable()
export class WorkspaceInviteService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly quotaService: WorkspaceQuotaService,
    private readonly emailJobService: EmailJobService,
  ) {}

  private hashToken(token: string): string {
    return createHash("sha256").update(token).digest("hex");
  }

  private normalizeEmail(email: string): string {
    return email.trim().toLowerCase();
  }

  async createInvite(
    workspaceId: string,
    invitedById: string,
    dto: InviteMemberDto,
  ) {
    const emailNormalized = this.normalizeEmail(dto.email);

    await this.quotaService.enforceCollaboration(workspaceId);

    // Check seat limit
    await this.quotaService.enforceCanAddMember(workspaceId);

    // Check if user is already a member
    const existingUser = await this.prisma.user.findUnique({
      where: { email: emailNormalized },
    });

    if (existingUser) {
      const existingMember = await this.prisma.workspaceMember.findUnique({
        where: {
          workspaceId_userId: { workspaceId, userId: existingUser.id },
        },
      });

      if (existingMember && existingMember.status === "active") {
        throw new BadRequestException(
          "User is already a member of this workspace",
        );
      }
    }

    // Revoke existing pending invite for same email in this workspace
    await this.prisma.workspaceInvite.updateMany({
      where: {
        workspaceId,
        emailNormalized,
        status: "pending",
      },
      data: { status: "revoked" },
    });

    // Generate token
    const rawToken = randomBytes(32).toString("hex");
    const tokenHash = this.hashToken(rawToken);

    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 7);

    const invite = await this.prisma.workspaceInvite.create({
      data: {
        workspaceId,
        email: dto.email.trim(),
        emailNormalized,
        tokenHash,
        role: dto.role,
        expiresAt,
        invitedById,
      },
    });

    // Get workspace and inviter info for email
    const workspace = await this.prisma.workspace.findUniqueOrThrow({
      where: { id: workspaceId },
    });
    const inviter = await this.prisma.user.findUniqueOrThrow({
      where: { id: invitedById },
      select: { email: true },
    });

    // Queue invite email
    await this.emailJobService.enqueue({
      type: "workspace_invite",
      recipientEmail: dto.email.trim(),
      payload: {
        inviteId: invite.id,
        token: rawToken,
        workspaceName: workspace.name,
        inviterEmail: inviter.email,
        role: dto.role,
        expiresAt: expiresAt.toISOString(),
      },
    });

    return {
      id: invite.id,
      email: invite.email,
      role: invite.role,
      status: invite.status,
      expiresAt: invite.expiresAt,
    };
  }

  async acceptInvite(token: string, userId: string) {
    const tokenHash = this.hashToken(token);

    const invite = await this.prisma.workspaceInvite.findUnique({
      where: { tokenHash },
    });

    if (!invite) {
      throw new NotFoundException("Invite not found or invalid token");
    }

    if (invite.status !== "pending") {
      throw new BadRequestException(`Invite is already ${invite.status}`);
    }

    if (new Date() > invite.expiresAt) {
      await this.prisma.workspaceInvite.update({
        where: { id: invite.id },
        data: { status: "expired" },
      });
      throw new BadRequestException("Invite has expired");
    }

    // Verify email match
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
    });

    if (this.normalizeEmail(user.email) !== invite.emailNormalized) {
      throw new BadRequestException(
        "This invite was sent to a different email address. Please sign in with the correct account.",
      );
    }

    await this.quotaService.enforceCollaboration(invite.workspaceId);

    // Check seat limit at acceptance time
    await this.quotaService.enforceCanAddMember(invite.workspaceId);

    // Check for existing membership
    const existingMember = await this.prisma.workspaceMember.findUnique({
      where: {
        workspaceId_userId: { workspaceId: invite.workspaceId, userId },
      },
    });

    if (existingMember && existingMember.status === "active") {
      // Already a member, just mark invite as accepted
      await this.prisma.workspaceInvite.update({
        where: { id: invite.id },
        data: {
          status: "accepted",
          acceptedById: userId,
          acceptedAt: new Date(),
        },
      });

      const ws = await this.prisma.workspace.findUnique({
        where: { id: invite.workspaceId },
        select: { channelId: true },
      });

      return {
        workspaceId: invite.workspaceId,
        channelId: ws?.channelId ?? null,
        alreadyMember: true,
      };
    }

    // Create or reactivate membership
    await this.prisma.$transaction([
      existingMember
        ? this.prisma.workspaceMember.update({
            where: { id: existingMember.id },
            data: { status: "active", role: invite.role, joinedAt: new Date() },
          })
        : this.prisma.workspaceMember.create({
            data: {
              workspaceId: invite.workspaceId,
              userId,
              role: invite.role,
              status: "active",
              joinedAt: new Date(),
            },
          }),
      this.prisma.workspaceInvite.update({
        where: { id: invite.id },
        data: {
          status: "accepted",
          acceptedById: userId,
          acceptedAt: new Date(),
        },
      }),
    ]);

    // Resolve channelId for redirect
    const workspace = await this.prisma.workspace.findUnique({
      where: { id: invite.workspaceId },
      select: { channelId: true },
    });

    return {
      workspaceId: invite.workspaceId,
      channelId: workspace?.channelId ?? null,
      alreadyMember: false,
    };
  }

  async revokeInvite(inviteId: string, workspaceId: string) {
    const invite = await this.prisma.workspaceInvite.findFirst({
      where: { id: inviteId, workspaceId, status: "pending" },
    });

    if (!invite) {
      throw new NotFoundException("Pending invite not found");
    }

    return this.prisma.workspaceInvite.update({
      where: { id: inviteId },
      data: { status: "revoked" },
    });
  }

  async resendInvite(inviteId: string, workspaceId: string) {
    await this.quotaService.enforceCollaboration(workspaceId);

    const invite = await this.prisma.workspaceInvite.findFirst({
      where: { id: inviteId, workspaceId, status: "pending" },
      include: { workspace: true },
    });

    if (!invite) {
      throw new NotFoundException("Pending invite not found");
    }

    if (new Date() > invite.expiresAt) {
      throw new BadRequestException(
        "Invite has expired. Create a new invite instead.",
      );
    }

    const inviter = await this.prisma.user.findUniqueOrThrow({
      where: { id: invite.invitedById },
      select: { email: true },
    });

    // Generate a new token for resend
    const rawToken = randomBytes(32).toString("hex");
    const tokenHash = this.hashToken(rawToken);

    await this.prisma.workspaceInvite.update({
      where: { id: inviteId },
      data: { tokenHash },
    });

    await this.emailJobService.enqueue({
      type: "workspace_invite",
      recipientEmail: invite.email,
      payload: {
        inviteId: invite.id,
        token: rawToken,
        workspaceName: invite.workspace.name,
        inviterEmail: inviter.email,
        role: invite.role,
        expiresAt: invite.expiresAt.toISOString(),
      },
    });

    return { resent: true };
  }

  async listInvites(workspaceId: string) {
    return this.prisma.workspaceInvite.findMany({
      where: { workspaceId },
      select: {
        id: true,
        email: true,
        role: true,
        status: true,
        expiresAt: true,
        createdAt: true,
      },
      orderBy: { createdAt: "desc" },
    });
  }

  async resolveToken(token: string) {
    const tokenHash = this.hashToken(token);

    const invite = await this.prisma.workspaceInvite.findUnique({
      where: { tokenHash },
      include: {
        workspace: { select: { id: true, name: true, avatar: true } },
      },
    });

    if (!invite) {
      throw new NotFoundException("Invite not found");
    }

    return {
      workspaceName: invite.workspace.name,
      workspaceAvatar: invite.workspace.avatar,
      email: invite.email,
      role: invite.role,
      status: invite.status,
      expiresAt: invite.expiresAt,
      expired: new Date() > invite.expiresAt,
    };
  }
}
