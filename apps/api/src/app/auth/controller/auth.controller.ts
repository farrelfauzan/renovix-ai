import { Controller, Get, Patch, Body, Req } from "@nestjs/common";
import { Access } from "../../../common/decorators/access.decorator";
import { AuthService } from "../service/auth.service";
import { UpdateProfileDto } from "../dto/create-auth.dto";
import { createInvalidBodyException } from "../../../common/utils/create-invalid-body-exception";

/**
 * The signed-in user's profile. Email sign-up, sign-in and sign-out are Better Auth's own endpoints
 * (`/api/auth/better/sign-up/email`, `/sign-in/email`, `/sign-out`); `POST /auth/register`, `/auth/login` and
 * `/auth/logout`, which issued and cleared the login JWT, are gone (RNX-225).
 */
@Controller("auth")
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Get("me")
  @Access({ auth: ["session"] })
  async getProfile(@Req() req: any) {
    return this.authService.getProfile(req.user.userId);
  }

  @Patch("me")
  @Access({ auth: ["session"] })
  async updateProfile(@Req() req: any, @Body() body: unknown) {
    const parsed = UpdateProfileDto.safeParse(body);
    if (!parsed.success) {
      throw createInvalidBodyException(parsed.error);
    }
    return this.authService.updateProfile(req.user.userId, parsed.data);
  }
}
