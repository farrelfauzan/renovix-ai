import {
  Controller,
  Post,
  Get,
  Body,
  Query,
  Req,
  UseGuards,
  HttpCode,
  BadRequestException,
} from "@nestjs/common";
import { CombinedAuthGuard } from "../../guards/combined-auth.guard";
import { WorkspaceInviteService } from "../service/workspace-invite.service";
import { AcceptInviteSchema } from "../dto/accept-invite.dto";

@Controller("workspace-invites")
export class WorkspaceInviteController {
  constructor(private readonly inviteService: WorkspaceInviteService) {}

  @Get("accept")
  async resolveInvite(@Query("token") token: string) {
    if (!token) {
      throw new BadRequestException("Token is required");
    }
    return this.inviteService.resolveToken(token);
  }

  @Post("accept")
  @HttpCode(200)
  @UseGuards(CombinedAuthGuard)
  async acceptInvite(@Body() body: unknown, @Req() req: any) {
    const parsed = AcceptInviteSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException({
        error: {
          message: "Invalid request body",
          type: "invalid_request_error",
          details: parsed.error.flatten().fieldErrors,
        },
      });
    }
    return this.inviteService.acceptInvite(parsed.data.token, req.user.userId);
  }
}
