import { Controller, Get, Patch, Put, Body, Req } from "@nestjs/common";
import { Access } from "../../../common/decorators/access.decorator";
import { AuthService } from "../service/auth.service";
import { UpdateProfileDto } from "../dto/create-auth.dto";
import { CompleteProfileDto } from "../dto/complete-profile.dto";
import { createInvalidBodyException } from "../../../common/utils/create-invalid-body-exception";
import type { SignedInUserRequest } from "../types/signed-in-user-request";

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

  /**
   * RNX-33: the profile step after first sign-in. Session only, and only the session user's own profile: the path
   * names no user and the body may not either (an unknown key is a 400).
   */
  @Put("me/profile")
  @Access({ auth: ["session"] })
  async completeProfile(@Req() req: SignedInUserRequest, @Body() body: unknown) {
    const parsed = CompleteProfileDto.safeParse(body);
    if (!parsed.success) {
      throw createInvalidBodyException(parsed.error);
    }
    return this.authService.completeProfile(req.user.userId, parsed.data);
  }
}
