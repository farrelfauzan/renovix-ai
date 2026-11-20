import { Body, Controller, Get, HttpCode, Post, Req } from "@nestjs/common";
import { Access } from "../../../common/decorators/access.decorator";
import { createInvalidBodyException } from "../../../common/utils/create-invalid-body-exception";
import { SetPasswordDto } from "../dto/set-password.dto";
import { SignInSecurityService } from "../service/sign-in-security.service";
import type { SessionRequest } from "../types/session-request";
import type { SessionView } from "../types/session-view";
import { toWebHeaders } from "../utils/to-web-headers";

/**
 * RNX-78: Settings > Sign-in and security. Session only, and only the session user's own account: the paths and
 * bodies name no user and no session.
 */
@Controller("auth")
export class SignInSecurityController {
  constructor(private readonly signInSecurity: SignInSecurityService) {}

  /** The signed-in user's active sessions: device, last active and which one is this one; no token, IP or location. */
  @Get("sessions")
  @Access({ auth: ["session"] })
  listSessions(@Req() req: SessionRequest): Promise<SessionView[]> {
    return this.signInSecurity.listSessions(toWebHeaders(req.headers), req.user.userId);
  }

  /** A first password for an account that signed up with Google or GitHub; refused when it already has one. */
  @Post("password")
  @HttpCode(204)
  @Access({ auth: ["session"] })
  async setPassword(@Req() req: SessionRequest, @Body() body: unknown): Promise<void> {
    const parsed = SetPasswordDto.safeParse(body);
    if (!parsed.success) {
      throw createInvalidBodyException(parsed.error);
    }
    await this.signInSecurity.setPassword(toWebHeaders(req.headers), parsed.data.newPassword);
  }
}
