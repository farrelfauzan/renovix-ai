import {
  Controller,
  Post,
  Get,
  Patch,
  Body,
  Req,
  UseGuards,
  BadRequestException,
  HttpCode,
  Res,
} from "@nestjs/common";
import { Throttle } from "@nestjs/throttler";
import type { FastifyReply } from "fastify";
import { CombinedAuthGuard } from "../guards/combined-auth.guard";
import { AuthService } from "./auth.service";
import { RegisterDto, LoginDto, UpdateProfileDto } from "./dto/create-auth.dto";
import { authCookie, clearedAuthCookie } from "./auth-cookie";

@Controller("auth")
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post("register")
  @Throttle({ default: { ttl: 60000, limit: 3 } })
  async register(
    @Body() body: unknown,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    const parsed = RegisterDto.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException(parsed.error.flatten().fieldErrors);
    }
    const result = await this.authService.register(parsed.data);
    reply.header("set-cookie", authCookie(result.token));
    return result;
  }

  @Post("login")
  @HttpCode(200)
  @Throttle({ default: { ttl: 60000, limit: 5 } })
  async login(
    @Body() body: unknown,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    const parsed = LoginDto.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException(parsed.error.flatten().fieldErrors);
    }
    const result = await this.authService.login(parsed.data);
    reply.header("set-cookie", authCookie(result.token));
    return result;
  }

  @Post("logout")
  @HttpCode(204)
  logout(@Res({ passthrough: true }) reply: FastifyReply) {
    reply.header("set-cookie", clearedAuthCookie());
  }

  @Get("me")
  @UseGuards(CombinedAuthGuard)
  async getProfile(@Req() req: any) {
    return this.authService.getProfile(req.user.userId);
  }

  @Patch("me")
  @UseGuards(CombinedAuthGuard)
  async updateProfile(@Req() req: any, @Body() body: unknown) {
    const parsed = UpdateProfileDto.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException(parsed.error.flatten().fieldErrors);
    }
    return this.authService.updateProfile(req.user.userId, parsed.data);
  }

  @Post("keys/regenerate")
  @UseGuards(CombinedAuthGuard)
  @HttpCode(200)
  async regenerateApiKey(@Req() req: any) {
    return this.authService.regenerateApiKey(req.user.userId);
  }
}
