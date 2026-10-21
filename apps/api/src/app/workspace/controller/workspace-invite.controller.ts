import {
  Controller,
  Post,
  Get,
  Body,
  Query,
  Req,
  HttpCode,
  BadRequestException,
} from "@nestjs/common";
import { Access } from "../../../common/decorators/access.decorator";
import { WorkspaceInviteService } from "../service/workspace-invite.service";
import { AcceptInviteSchema } from "../dto/accept-invite.dto";
import { createInvalidBodyException } from "../../../common/utils/create-invalid-body-exception";

@Controller("workspace-invites")
export class WorkspaceInviteController {
  constructor(private readonly inviteService: WorkspaceInviteService) {}

  @Get("accept")
  @Access({ public: true, reason: "shows an invite by its token before the invited person signs in" })
  async resolveInvite(@Query("token") token: string) {
    if (!token) {
      throw new BadRequestException("Token is required");
    }
    return this.inviteService.resolveToken(token);
  }

  @Post("accept")
  @HttpCode(200)
  @Access({ auth: ["jwt", "session"] })
  async acceptInvite(@Body() body: unknown, @Req() req: any) {
    const parsed = AcceptInviteSchema.safeParse(body);
    if (!parsed.success) {
      throw createInvalidBodyException(parsed.error);
    }
    return this.inviteService.acceptInvite(parsed.data.token, req.user.userId);
  }
}
