import { BadRequestException, Body, Controller, Delete, Get, Header, HttpCode, Inject, Param, Post, Req, Res } from "@nestjs/common";
import { Throttle } from "@nestjs/throttler";
import type { FastifyReply, FastifyRequest } from "fastify";
import { Access } from "../../../common/decorators/access.decorator";
import { ADMIN_AUTH_CONFIG } from "../config/admin-auth-config.token";
import { ADMIN_COOKIES } from "../config/admin-cookies";
import { ReauthDto } from "../dto/reauth.dto";
import { SignInDto } from "../dto/sign-in.dto";
import { TotpCodeDto } from "../dto/totp-code.dto";
import { AdminEnrolmentService } from "../service/admin-enrolment.service";
import { AdminSessionService } from "../service/admin-session.service";
import { AdminSignInService } from "../service/admin-sign-in.service";
import type { AdminAuthConfig } from "../types/admin-auth-config";
import type { AdminRequest } from "../types/admin-request";
import type { IssuedAdminSession } from "../types/issued-admin-session";
import { buildClearedSessionCookies } from "../utils/build-cleared-session-cookies";
import { buildSessionCookies } from "../utils/build-session-cookies";
import { readCookie } from "../utils/read-cookie";

/**
 * Back-office sign-in and sessions (RX-94), API only (D109). Under /api/v1/admin/auth. The tokens travel
 * only in the back-office cookies, never in a response body.
 */
@Controller("admin/auth")
export class AdminAuthController {
  constructor(
    private readonly credentials: AdminSignInService,
    private readonly enrolment: AdminEnrolmentService,
    private readonly sessions: AdminSessionService,
    @Inject(ADMIN_AUTH_CONFIG) private readonly settings: AdminAuthConfig,
  ) {}

  /** Email + password (+ TOTP or a recovery code once enrolled). Sets the cookies; the scope says what the session may do. */
  @Post("sign-in")
  @Access({ public: true, reason: "back-office sign-in: the caller has no session yet" })
  @HttpCode(200)
  @Throttle({ default: { ttl: 60000, limit: 10 } })
  async signIn(@Body() body: unknown, @Req() req: FastifyRequest, @Res({ passthrough: true }) reply: FastifyReply) {
    const parsed = SignInDto.safeParse(body);
    if (!parsed.success) throw new BadRequestException(parsed.error.flatten().fieldErrors);
    const session = await this.credentials.signIn(parsed.data, req.headers["user-agent"]);
    return this.sendSession(reply, session);
  }

  /** Rotates the refresh token from the refresh cookie and sets new cookies. */
  @Post("refresh")
  @Access({ public: true, reason: "authenticated by the back-office refresh cookie inside the handler; the access token may have expired" })
  @HttpCode(200)
  async refresh(@Req() req: FastifyRequest, @Res({ passthrough: true }) reply: FastifyReply) {
    const session = await this.sessions.refresh(readCookie(req.headers.cookie, ADMIN_COOKIES.refresh));
    return this.sendSession(reply, session);
  }

  /** Ends the current session (enrolment or full) and clears the cookies. */
  @Post("sign-out")
  @Access({ auth: ["staff"], staffScope: "any" })
  @HttpCode(204)
  async signOut(@Req() req: AdminRequest, @Res({ passthrough: true }) reply: FastifyReply) {
    await this.sessions.end(req.admin.sessionId);
    reply.header("set-cookie", buildClearedSessionCookies());
  }

  /** Enrolment session only: a new TOTP secret, as an otpauth URI (for the QR code) and as text. */
  @Post("totp/enrol")
  @Access({ auth: ["staff"], staffScope: "enrolment" })
  @HttpCode(200)
  @Header("Cache-Control", "no-store")
  enrol(@Req() req: AdminRequest) {
    return this.enrolment.enrol(req.admin);
  }

  /** Enrolment session only: confirms with the first code; returns the recovery codes once and swaps to a full session. */
  @Post("totp/confirm")
  @Access({ auth: ["staff"], staffScope: "enrolment" })
  @HttpCode(200)
  @Header("Cache-Control", "no-store")
  async confirm(@Body() body: unknown, @Req() req: AdminRequest, @Res({ passthrough: true }) reply: FastifyReply) {
    const parsed = TotpCodeDto.safeParse(body);
    if (!parsed.success) throw new BadRequestException(parsed.error.flatten().fieldErrors);
    const result = await this.enrolment.confirm(req.admin, parsed.data.code, req.headers["user-agent"]);
    this.sendSession(reply, result.session);
    return { recoveryCodes: result.recoveryCodes };
  }

  /** The admin's own live sessions. */
  @Get("sessions")
  @Access({ auth: ["staff"] })
  async listSessions(@Req() req: AdminRequest) {
    return { sessions: await this.sessions.list(req.admin) };
  }

  /** Revokes one of the admin's own sessions (another admin's: 404). */
  @Delete("sessions/:id")
  @Access({ auth: ["staff"] })
  @HttpCode(204)
  revokeSession(@Req() req: AdminRequest, @Param("id") id: string) {
    return this.sessions.revokeOwn(req.admin, id);
  }

  /** Password + TOTP again: routes that declare `reauth: true` accept the session for the configured window. */
  @Post("reauth")
  @Access({ auth: ["staff"] })
  @HttpCode(204)
  @Throttle({ default: { ttl: 60000, limit: 10 } })
  async reauth(@Body() body: unknown, @Req() req: AdminRequest) {
    const parsed = ReauthDto.safeParse(body);
    if (!parsed.success) throw new BadRequestException(parsed.error.flatten().fieldErrors);
    await this.credentials.reauth(req.admin, parsed.data);
  }

  private sendSession(reply: FastifyReply, session: IssuedAdminSession): { scope: string } {
    reply.header("set-cookie", buildSessionCookies(session, this.settings.accessTokenSeconds, new Date()));
    return { scope: session.scope };
  }
}
