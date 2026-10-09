import {
  Controller,
  Post,
  Get,
  Patch,
  Delete,
  Body,
  Param,
  Req,
  UseGuards,
  HttpCode,
  ParseUUIDPipe,
  BadRequestException,
  NotFoundException,
  ForbiddenException,
} from "@nestjs/common";
import { Throttle } from "@nestjs/throttler";
import { CombinedAuthGuard } from "../guards/combined-auth.guard";
import { PrismaService } from "../prisma/prisma.service";
import { WorkspaceService } from "./workspace.service";
import { WorkspaceMemberService } from "./workspace-member.service";
import { WorkspaceInviteService } from "./workspace-invite.service";
import { WorkspaceQuotaService } from "./workspace-quota.service";
import { InviteMemberSchema } from "./dto/invite-member.dto";
import { UpdateMemberSchema } from "./dto/update-member.dto";
import { WorkspaceKnowledgeService } from "./workspace-knowledge.service";

@Controller("channels/:channelId/workspace")
@UseGuards(CombinedAuthGuard)
export class WorkspaceChannelController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly workspaceService: WorkspaceService,
    private readonly memberService: WorkspaceMemberService,
    private readonly inviteService: WorkspaceInviteService,
    private readonly quotaService: WorkspaceQuotaService,
    private readonly knowledgeService: WorkspaceKnowledgeService,
  ) {}

  /** Resolve channel → workspace, ensuring the user owns the channel */
  private async resolveWorkspace(channelId: string, userId: string) {
    const channel = await this.prisma.channel.findUnique({
      where: { id: channelId },
      include: { workspace: true },
    });

    if (!channel) {
      throw new NotFoundException("Server not found");
    }

    // Channel owner or workspace member can access
    if (channel.userId !== userId) {
      // Check if user is a workspace member
      if (channel.workspace) {
        const member = await this.prisma.workspaceMember.findUnique({
          where: {
            workspaceId_userId: { workspaceId: channel.workspace.id, userId },
          },
        });
        if (!member || member.status !== "active") {
          throw new ForbiddenException("You do not have access to this server");
        }
      } else {
        throw new ForbiddenException("You do not have access to this server");
      }
    }

    // Non-owners need a plan that allows collaboration (RX-113, D64)
    if (channel.workspace && channel.workspace.ownerId !== userId) {
      await this.quotaService.enforceCollaboration(channel.workspace.id);
    }

    return { channel, workspace: channel.workspace };
  }

  /** Require that workspace exists for the channel */
  private async requireWorkspace(channelId: string, userId: string) {
    const { channel, workspace } = await this.resolveWorkspace(
      channelId,
      userId,
    );
    if (!workspace) {
      throw new NotFoundException("Workspace not enabled for this server");
    }
    return { channel, workspace };
  }

  // ─── Workspace CRUD ────────────────────────────────────────────────────────

  @Get()
  async getWorkspace(
    @Param("channelId", ParseUUIDPipe) channelId: string,
    @Req() req: any,
  ) {
    const { channel, workspace } = await this.resolveWorkspace(
      channelId,
      req.user.userId,
    );

    if (!workspace) {
      return {
        exists: false,
        channelId: channel.id,
        channelName: channel.name,
      };
    }

    const members = await this.prisma.workspaceMember.findMany({
      where: { workspaceId: workspace.id, status: "active" },
      include: { user: { select: { id: true, email: true } } },
    });

    return {
      exists: true,
      workspace: {
        id: workspace.id,
        name: workspace.name,
        status: workspace.status,
        createdAt: workspace.createdAt,
      },
      members,
    };
  }

  @Post()
  @HttpCode(201)
  async createWorkspace(
    @Param("channelId", ParseUUIDPipe) channelId: string,
    @Req() req: any,
  ) {
    const channel = await this.prisma.channel.findUnique({
      where: { id: channelId },
      include: { workspace: true },
    });

    if (!channel) {
      throw new NotFoundException("Server not found");
    }

    if (channel.userId !== req.user.userId) {
      throw new ForbiddenException(
        "Only the server owner can create a workspace",
      );
    }

    if (channel.workspace) {
      return channel.workspace;
    }

    // Create workspace linked to this channel
    const slug =
      channel.name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-|-$/g, "")
        .slice(0, 48) || "workspace";

    const workspace = await this.prisma.workspace.create({
      data: {
        channelId: channel.id,
        ownerId: req.user.userId,
        name: channel.name,
        slug,
      },
    });

    // Auto-create owner as first member
    await this.prisma.workspaceMember.create({
      data: {
        workspaceId: workspace.id,
        userId: req.user.userId,
        role: "owner",
        status: "active",
        joinedAt: new Date(),
      },
    });

    return workspace;
  }

  // ─── Members ────────────────────────────────────────────────────────────────

  @Get("members")
  async listMembers(
    @Param("channelId", ParseUUIDPipe) channelId: string,
    @Req() req: any,
  ) {
    const { workspace } = await this.requireWorkspace(
      channelId,
      req.user.userId,
    );
    return this.memberService.listMembers(workspace.id);
  }

  @Patch("members/:memberId")
  async updateMember(
    @Param("channelId", ParseUUIDPipe) channelId: string,
    @Param("memberId", ParseUUIDPipe) memberId: string,
    @Body() body: unknown,
    @Req() req: any,
  ) {
    const { workspace } = await this.requireWorkspace(
      channelId,
      req.user.userId,
    );
    await this.workspaceService.requireRole(workspace.id, req.user.userId, [
      "owner",
      "admin",
    ]);

    const parsed = UpdateMemberSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException({
        error: {
          message: "Invalid request body",
          details: parsed.error.flatten().fieldErrors,
        },
      });
    }
    return this.memberService.updateMember(workspace.id, memberId, parsed.data);
  }

  @Delete("members/:memberId")
  async removeMember(
    @Param("channelId", ParseUUIDPipe) channelId: string,
    @Param("memberId", ParseUUIDPipe) memberId: string,
    @Req() req: any,
  ) {
    const { workspace } = await this.requireWorkspace(
      channelId,
      req.user.userId,
    );
    await this.workspaceService.requireRole(workspace.id, req.user.userId, [
      "owner",
      "admin",
    ]);
    return this.memberService.removeMember(workspace.id, memberId);
  }

  // ─── Invites ────────────────────────────────────────────────────────────────

  @Get("invites")
  async listInvites(
    @Param("channelId", ParseUUIDPipe) channelId: string,
    @Req() req: any,
  ) {
    const { workspace } = await this.requireWorkspace(
      channelId,
      req.user.userId,
    );
    await this.workspaceService.requireRole(workspace.id, req.user.userId, [
      "owner",
      "admin",
    ]);
    return this.inviteService.listInvites(workspace.id);
  }

  @Post("invites")
  @HttpCode(201)
  @Throttle({ default: { ttl: 60000, limit: 10 } })
  async createInvite(
    @Param("channelId", ParseUUIDPipe) channelId: string,
    @Body() body: unknown,
    @Req() req: any,
  ) {
    const { workspace } = await this.requireWorkspace(
      channelId,
      req.user.userId,
    );
    await this.workspaceService.requireRole(workspace.id, req.user.userId, [
      "owner",
      "admin",
    ]);

    const parsed = InviteMemberSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException({
        error: {
          message: "Invalid request body",
          details: parsed.error.flatten().fieldErrors,
        },
      });
    }
    return this.inviteService.createInvite(
      workspace.id,
      req.user.userId,
      parsed.data,
    );
  }

  @Post("invites/:inviteId/resend")
  @HttpCode(200)
  async resendInvite(
    @Param("channelId", ParseUUIDPipe) channelId: string,
    @Param("inviteId", ParseUUIDPipe) inviteId: string,
    @Req() req: any,
  ) {
    const { workspace } = await this.requireWorkspace(
      channelId,
      req.user.userId,
    );
    await this.workspaceService.requireRole(workspace.id, req.user.userId, [
      "owner",
      "admin",
    ]);
    return this.inviteService.resendInvite(inviteId, workspace.id);
  }

  @Post("invites/:inviteId/revoke")
  @HttpCode(200)
  async revokeInvite(
    @Param("channelId", ParseUUIDPipe) channelId: string,
    @Param("inviteId", ParseUUIDPipe) inviteId: string,
    @Req() req: any,
  ) {
    const { workspace } = await this.requireWorkspace(
      channelId,
      req.user.userId,
    );
    await this.workspaceService.requireRole(workspace.id, req.user.userId, [
      "owner",
      "admin",
    ]);
    return this.inviteService.revokeInvite(inviteId, workspace.id);
  }

  // ─── Quota ──────────────────────────────────────────────────────────────────

  @Get("quota")
  async getQuota(
    @Param("channelId", ParseUUIDPipe) channelId: string,
    @Req() req: any,
  ) {
    const { workspace } = await this.requireWorkspace(
      channelId,
      req.user.userId,
    );
    return this.quotaService.getQuota(workspace.id);
  }

  // ─── Knowledge Bases ────────────────────────────────────────────────────────

  @Get("knowledge")
  async listKnowledgeBases(
    @Param("channelId", ParseUUIDPipe) channelId: string,
    @Req() req: any,
  ) {
    const { workspace } = await this.requireWorkspace(
      channelId,
      req.user.userId,
    );
    return this.knowledgeService.listKnowledgeBases(workspace.id);
  }

  @Post("knowledge")
  @HttpCode(201)
  async createKnowledgeBase(
    @Param("channelId", ParseUUIDPipe) channelId: string,
    @Body() body: { name: string; description?: string },
    @Req() req: any,
  ) {
    const { workspace } = await this.requireWorkspace(
      channelId,
      req.user.userId,
    );
    // Only the workspace owner adds a knowledge base (RX-113, D63)
    await this.workspaceService.requireRole(workspace.id, req.user.userId, [
      "owner",
    ]);
    return this.knowledgeService.createKnowledgeBase(
      workspace.id,
      req.user.userId,
      body,
    );
  }

  @Delete("knowledge/:kbId")
  async deleteKnowledgeBase(
    @Param("channelId", ParseUUIDPipe) channelId: string,
    @Param("kbId", ParseUUIDPipe) kbId: string,
    @Req() req: any,
  ) {
    const { workspace } = await this.requireWorkspace(
      channelId,
      req.user.userId,
    );
    await this.workspaceService.requireRole(workspace.id, req.user.userId, [
      "owner",
      "admin",
    ]);
    await this.knowledgeService.deleteKnowledgeBase(workspace.id, kbId);
    return { deleted: true };
  }

  @Get("knowledge/:kbId/chunks")
  async listChunks(
    @Param("channelId", ParseUUIDPipe) channelId: string,
    @Param("kbId", ParseUUIDPipe) kbId: string,
    @Req() req: any,
  ) {
    const { workspace } = await this.requireWorkspace(
      channelId,
      req.user.userId,
    );
    return this.knowledgeService.listChunks(workspace.id, kbId);
  }

  @Post("knowledge/:kbId/chunks")
  @HttpCode(201)
  async addChunks(
    @Param("channelId", ParseUUIDPipe) channelId: string,
    @Param("kbId", ParseUUIDPipe) kbId: string,
    @Body()
    body: { chunks: { content: string; metadata?: Record<string, unknown> }[] },
    @Req() req: any,
  ) {
    const { workspace } = await this.requireWorkspace(
      channelId,
      req.user.userId,
    );
    await this.workspaceService.requireRole(workspace.id, req.user.userId, [
      "owner",
      "admin",
      "member",
    ]);
    return this.knowledgeService.addChunks(
      workspace.id,
      kbId,
      req.user.userId,
      body.chunks,
    );
  }

  @Delete("knowledge/:kbId/chunks/:chunkId")
  async deleteChunk(
    @Param("channelId", ParseUUIDPipe) channelId: string,
    @Param("kbId", ParseUUIDPipe) kbId: string,
    @Param("chunkId", ParseUUIDPipe) chunkId: string,
    @Req() req: any,
  ) {
    const { workspace } = await this.requireWorkspace(
      channelId,
      req.user.userId,
    );
    await this.workspaceService.requireRole(workspace.id, req.user.userId, [
      "owner",
      "admin",
    ]);
    await this.knowledgeService.deleteChunk(workspace.id, kbId, chunkId);
    return { deleted: true };
  }

  @Post("knowledge/search")
  @HttpCode(200)
  async searchKnowledge(
    @Param("channelId", ParseUUIDPipe) channelId: string,
    @Body() body: { query: string; topK?: number },
    @Req() req: any,
  ) {
    const { workspace } = await this.requireWorkspace(
      channelId,
      req.user.userId,
    );
    return this.knowledgeService.searchWorkspaceKnowledge(
      workspace.id,
      body.query,
      body.topK,
    );
  }
}
