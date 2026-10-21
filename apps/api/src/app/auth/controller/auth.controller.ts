import {
  Controller,
  Post,
  Get,
  Patch,
  Body,
  Req,
  HttpCode,
  Res,
} from "@nestjs/common";
import { Throttle } from "@nestjs/throttler";
import type { FastifyReply } from "fastify";
import { Access } from "../../../common/decorators/access.decorator";
import { AuthService } from "../service/auth.service";
import { RegisterDto, LoginDto, UpdateProfileDto } from "../dto/create-auth.dto";
import { authCookie, clearedAuthCookie } from "../utils/auth-cookie";
import { createInvalidBodyException } from "../../../common/utils/create-invalid-body-exception";

@Controller("auth")
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post("register")
  @Access({ public: true, reason: "sign-up: the caller has no account yet" })
  @Throttle({ default: { ttl: 60000, limit: 3 } })
  async register(
    @Body() body: unknown,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    const parsed = RegisterDto.safeParse(body);
    if (!parsed.success) {
      throw createInvalidBodyException(parsed.error);
    }
    const result = await this.authService.register(parsed.data);
    reply.header("set-cookie", authCookie(result.token));
    return result;
  }

  @Post("login")
  @Access({ public: true, reason: "sign-in: the caller has no token yet" })
  @HttpCode(200)
  @Throttle({ default: { ttl: 60000, limit: 5 } })
  async login(
    @Body() body: unknown,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    const parsed = LoginDto.safeParse(body);
    if (!parsed.success) {
      throw createInvalidBodyException(parsed.error);
    }
    const result = await this.authService.login(parsed.data);
    reply.header("set-cookie", authCookie(result.token));
    return result;
  }

  @Post("logout")
  @Access({ public: true, reason: "only clears the login cookie; must work with an expired token" })
  @HttpCode(204)
  logout(@Res({ passthrough: true }) reply: FastifyReply) {
    reply.header("set-cookie", clearedAuthCookie());
  }

  @Get("me")
  @Access({ auth: ["jwt", "session"] })
  async getProfile(@Req() req: any) {
    return this.authService.getProfile(req.user.userId);
  }

  @Patch("me")
  @Access({ auth: ["jwt", "session"] })
  async updateProfile(@Req() req: any, @Body() body: unknown) {
    const parsed = UpdateProfileDto.safeParse(body);
    if (!parsed.success) {
      throw createInvalidBodyException(parsed.error);
    }
    return this.authService.updateProfile(req.user.userId, parsed.data);
  }
}
