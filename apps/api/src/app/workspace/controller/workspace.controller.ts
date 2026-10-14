import {
  Controller,
  Post,
  Get,
  Patch,
  Delete,
  Body,
  Param,
  Req,
  HttpCode,
  ParseUUIDPipe,
  BadRequestException,
} from "@nestjs/common";
import { Throttle } from "@nestjs/throttler";
import { Access } from "../../../common/decorators/access.decorator";
import { WorkspaceService } from "../service/workspace.service";
import { WorkspaceMemberService } from "../service/workspace-member.service";
import { WorkspaceInviteService } from "../service/workspace-invite.service";
import { WorkspaceQuotaService } from "../service/workspace-quota.service";
import { CreateWorkspaceSchema } from "../dto/create-workspace.dto";
import { UpdateWorkspaceSchema } from "../dto/update-workspace.dto";
import { InviteMemberSchema } from "../dto/invite-member.dto";
import { UpdateMemberSchema } from "../dto/update-member.dto";

@Controller("workspaces")
@Access({ auth: ["jwt", "session"] })
export class WorkspaceController {
  constructor(
    private readonly workspaceService: WorkspaceService,
    private readonly memberService: WorkspaceMemberService,
    private readonly inviteService: WorkspaceInviteService,
    private readonly quotaService: WorkspaceQuotaService,
  ) {}

  @Post()
  @HttpCode(201)
  @Throttle({ default: { ttl: 60000, limit: 5 } })
  async create(@Body() body: unknown, @Req() req: any) {
    const parsed = CreateWorkspaceSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException({
        error: {
          message: "Invalid request body",
          type: "invalid_request_error",
          details: parsed.error.flatten().fieldErrors,
        },
      });
    }
    return this.workspaceService.create(req.user.userId, parsed.data);
  }

  @Get()
  async list(@Req() req: any) {
    return this.workspaceService.list(req.user.userId);
  }

  @Get(":id")
  async getById(@Param("id", ParseUUIDPipe) id: string, @Req() req: any) {
    return this.workspaceService.getById(id, req.user.userId);
  }

  @Patch(":id")
  async update(
    @Param("id", ParseUUIDPipe) id: string,
    @Body() body: unknown,
    @Req() req: any,
  ) {
    const parsed = UpdateWorkspaceSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException({
        error: {
          message: "Invalid request body",
          type: "invalid_request_error",
          details: parsed.error.flatten().fieldErrors,
        },
      });
    }
    return this.workspaceService.update(id, req.user.userId, parsed.data);
  }

  @Delete(":id")
  async archive(@Param("id", ParseUUIDPipe) id: string, @Req() req: any) {
    return this.workspaceService.archive(id, req.user.userId);
  }

  // ─── Quota ──────────────────────────────────────────────────────────────────

  @Get(":id/quota")
  async getQuota(@Param("id", ParseUUIDPipe) id: string, @Req() req: any) {
    await this.workspaceService.requireMembership(id, req.user.userId);
    return this.quotaService.getQuota(id);
  }

  // ─── Members ────────────────────────────────────────────────────────────────

  @Get(":id/members")
  async listMembers(@Param("id", ParseUUIDPipe) id: string, @Req() req: any) {
    await this.workspaceService.requireMembership(id, req.user.userId);
    return this.memberService.listMembers(id);
  }

  @Patch(":id/members/:memberId")
  async updateMember(
    @Param("id", ParseUUIDPipe) id: string,
    @Param("memberId", ParseUUIDPipe) memberId: string,
    @Body() body: unknown,
    @Req() req: any,
  ) {
    await this.workspaceService.requireRole(id, req.user.userId, [
      "owner",
      "admin",
    ]);
    const parsed = UpdateMemberSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException({
        error: {
          message: "Invalid request body",
          type: "invalid_request_error",
          details: parsed.error.flatten().fieldErrors,
        },
      });
    }
    return this.memberService.updateMember(id, memberId, parsed.data);
  }

  @Delete(":id/members/:memberId")
  async removeMember(
    @Param("id", ParseUUIDPipe) id: string,
    @Param("memberId", ParseUUIDPipe) memberId: string,
    @Req() req: any,
  ) {
    await this.workspaceService.requireRole(id, req.user.userId, [
      "owner",
      "admin",
    ]);
    return this.memberService.removeMember(id, memberId);
  }

  // ─── Invites ────────────────────────────────────────────────────────────────

  @Get(":id/invites")
  async listInvites(@Param("id", ParseUUIDPipe) id: string, @Req() req: any) {
    await this.workspaceService.requireRole(id, req.user.userId, [
      "owner",
      "admin",
    ]);
    return this.inviteService.listInvites(id);
  }

  @Post(":id/invites")
  @HttpCode(201)
  @Throttle({ default: { ttl: 60000, limit: 10 } })
  async createInvite(
    @Param("id", ParseUUIDPipe) id: string,
    @Body() body: unknown,
    @Req() req: any,
  ) {
    await this.workspaceService.requireRole(id, req.user.userId, [
      "owner",
      "admin",
    ]);
    const parsed = InviteMemberSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException({
        error: {
          message: "Invalid request body",
          type: "invalid_request_error",
          details: parsed.error.flatten().fieldErrors,
        },
      });
    }
    return this.inviteService.createInvite(id, req.user.userId, parsed.data);
  }

  @Post(":id/invites/:inviteId/resend")
  @HttpCode(200)
  async resendInvite(
    @Param("id", ParseUUIDPipe) id: string,
    @Param("inviteId", ParseUUIDPipe) inviteId: string,
    @Req() req: any,
  ) {
    await this.workspaceService.requireRole(id, req.user.userId, [
      "owner",
      "admin",
    ]);
    return this.inviteService.resendInvite(inviteId, id);
  }

  @Post(":id/invites/:inviteId/revoke")
  @HttpCode(200)
  async revokeInvite(
    @Param("id", ParseUUIDPipe) id: string,
    @Param("inviteId", ParseUUIDPipe) inviteId: string,
    @Req() req: any,
  ) {
    await this.workspaceService.requireRole(id, req.user.userId, [
      "owner",
      "admin",
    ]);
    return this.inviteService.revokeInvite(inviteId, id);
  }
}
