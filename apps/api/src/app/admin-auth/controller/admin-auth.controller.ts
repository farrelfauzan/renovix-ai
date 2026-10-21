import { Body, Controller, Delete, Get, Header, HttpCode, Inject, Param, Post, Req, Res } from "@nestjs/common";
import { Throttle } from "@nestjs/throttler";
import type { FastifyReply, FastifyRequest } from "fastify";
import { Access } from "../../../common/decorators/access.decorator";
import { ADMIN_AUTH_CONFIG } from "../config/admin-auth-config.token";
import { ADMIN_COOKIES } from "../config/admin-cookies";
import { AdminAudit } from "../decorator/admin-audit.decorator";
import { ChangePasswordDto } from "../dto/change-password.dto";
import { ReauthDto } from "../dto/reauth.dto";
import { SignInDto } from "../dto/sign-in.dto";
import { TotpCodeDto } from "../dto/totp-code.dto";
import { AdminAccountService } from "../service/admin-account.service";
import { AdminEnrolmentService } from "../service/admin-enrolment.service";
import { AdminSessionService } from "../service/admin-session.service";
import { AdminSignInService } from "../service/admin-sign-in.service";
import type { AdminAuthConfig } from "../types/admin-auth-config";
import type { AdminRequest } from "../types/admin-request";
import type { AuditedAdminRequest } from "../types/audited-admin-request";
import type { IssuedAdminSession } from "../types/issued-admin-session";
import { buildClearedSessionCookies } from "../utils/build-cleared-session-cookies";
import { buildSessionCookies } from "../utils/build-session-cookies";
import { buildSessionRevokedChange } from "../utils/build-session-revoked-change";
import { readCookie } from "../utils/read-cookie";
import { createInvalidBodyException } from "../../../common/utils/create-invalid-body-exception";

/**
 * Back-office sign-in and sessions (RX-94), API only (D109). Under /api/v1/admin/auth. The tokens travel
 * only in the back-office cookies, never in a response body. Every write of a signed-in admin is audited
 * (RX-97, `@AdminAudit`): its writes use `req.audit.tx` and it records non-secret before/after values.
 */
@Controller("admin/auth")
export class AdminAuthController {
  constructor(
    private readonly credentials: AdminSignInService,
    private readonly enrolment: AdminEnrolmentService,
    private readonly sessions: AdminSessionService,
    private readonly account: AdminAccountService,
    @Inject(ADMIN_AUTH_CONFIG) private readonly settings: AdminAuthConfig,
  ) {}

  /** Email + password (+ TOTP or a recovery code once enrolled). Sets the cookies; the scope says what the session may do. */
  @Post("sign-in")
  @Access({ public: true, reason: "back-office sign-in: the caller has no session yet" })
  @AdminAudit({ exempt: true, reason: "no signed-in admin yet: the caller is still proving who they are" })
  @HttpCode(200)
  @Throttle({ default: { ttl: 60000, limit: 10 } })
  async signIn(@Body() body: unknown, @Req() req: FastifyRequest, @Res({ passthrough: true }) reply: FastifyReply) {
    const parsed = SignInDto.safeParse(body);
    if (!parsed.success) throw createInvalidBodyException(parsed.error);
    const session = await this.credentials.signIn(parsed.data, req.headers["user-agent"]);
    return this.sendSession(reply, session);
  }

  /** Rotates the refresh token from the refresh cookie and sets new cookies. */
  @Post("refresh")
  @Access({ public: true, reason: "authenticated by the back-office refresh cookie inside the handler; the access token may have expired" })
  @AdminAudit({ exempt: true, reason: "no signed-in admin yet: token rotation of an existing session, not an admin's change" })
  @HttpCode(200)
  async refresh(@Req() req: FastifyRequest, @Res({ passthrough: true }) reply: FastifyReply) {
    const session = await this.sessions.refresh(readCookie(req.headers.cookie, ADMIN_COOKIES.refresh));
    return this.sendSession(reply, session);
  }

  /** Ends the current session (enrolment or full) and clears the cookies. */
  @Post("sign-out")
  @Access({ auth: ["staff"], staffScope: "any" })
  @AdminAudit({ resource: "admin_session", action: "sign_out" })
  @HttpCode(204)
  async signOut(@Req() req: AuditedAdminRequest, @Res({ passthrough: true }) reply: FastifyReply) {
    await this.sessions.end(req.admin.sessionId, req.audit.tx);
    req.audit.record(buildSessionRevokedChange(req.admin.sessionId));
    reply.header("set-cookie", buildClearedSessionCookies());
  }

  /** Enrolment session only: a new TOTP secret, as an otpauth URI (for the QR code) and as text. */
  @Post("totp/enrol")
  @Access({ auth: ["staff"], staffScope: "enrolment" })
  @AdminAudit({ resource: "admin_totp", action: "enrol" })
  @HttpCode(200)
  @Header("Cache-Control", "no-store")
  async enrol(@Req() req: AuditedAdminRequest) {
    const secret = await this.enrolment.enrol(req.admin, req.audit.tx);
    req.audit.record({ before: { totpEnrolled: false }, after: { totpEnrolled: false, newSecretIssued: true } });
    return secret;
  }

  /** Enrolment session only: confirms with the first code; returns the recovery codes once and swaps to a full session. */
  @Post("totp/confirm")
  @Access({ auth: ["staff"], staffScope: "enrolment" })
  @AdminAudit({ resource: "admin_totp", action: "confirm" })
  @HttpCode(200)
  @Header("Cache-Control", "no-store")
  async confirm(@Body() body: unknown, @Req() req: AuditedAdminRequest, @Res({ passthrough: true }) reply: FastifyReply) {
    const parsed = TotpCodeDto.safeParse(body);
    if (!parsed.success) throw createInvalidBodyException(parsed.error);
    const result = await this.enrolment.confirm(req.admin, parsed.data.code, req.headers["user-agent"], req.audit.tx);
    req.audit.record({
      before: { totpEnrolled: false, sessionId: req.admin.sessionId, scope: req.admin.scope },
      after: { totpEnrolled: true, sessionId: result.session.sessionId, scope: result.session.scope, recoveryCodesIssued: result.recoveryCodes.length },
    });
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
  @AdminAudit({ resource: "admin_session", action: "revoke" })
  @HttpCode(204)
  async revokeSession(@Req() req: AuditedAdminRequest, @Param("id") id: string) {
    await this.sessions.revokeOwn(req.admin, id, req.audit.tx);
    req.audit.record(buildSessionRevokedChange(id));
  }

  /** Password + TOTP again: routes that declare `reauth: true` accept the session for the configured window. */
  @Post("reauth")
  @Access({ auth: ["staff"] })
  @AdminAudit({ resource: "admin_session", action: "reauth" })
  @HttpCode(204)
  @Throttle({ default: { ttl: 60000, limit: 10 } })
  async reauth(@Body() body: unknown, @Req() req: AuditedAdminRequest) {
    const parsed = ReauthDto.safeParse(body);
    if (!parsed.success) throw createInvalidBodyException(parsed.error);
    await this.credentials.reauth(req.admin, parsed.data, req.audit.tx);
    req.audit.record({ before: { sessionId: req.admin.sessionId }, after: { sessionId: req.admin.sessionId, reauthenticated: true } });
  }

  /** The signed-in admin, their role and permissions, and whether a password change is forced (RX-95; any session). */
  @Get("me")
  @Access({ auth: ["staff"], staffScope: "any" })
  @Header("Cache-Control", "no-store")
  async me(@Req() req: AdminRequest) {
    return this.account.profile(req.admin);
  }

  /**
   * After a forced password reset (RX-95), the only route a "password_change" session reaches: sets the new
   * password, clears the reset, ends every session of the admin and sets the cookies of a new full session.
   */
  @Post("password")
  @Access({ auth: ["staff"], staffScope: "password_change" })
  @AdminAudit({ resource: "admin_password", action: "change" })
  @HttpCode(200)
  @Throttle({ default: { ttl: 60000, limit: 10 } })
  async changePassword(@Body() body: unknown, @Req() req: AuditedAdminRequest, @Res({ passthrough: true }) reply: FastifyReply) {
    const parsed = ChangePasswordDto.safeParse(body);
    if (!parsed.success) throw createInvalidBodyException(parsed.error);
    const session = await this.account.changePassword(req.admin, parsed.data.newPassword, req.headers["user-agent"], req.audit.tx);
    req.audit.record({
      before: { mustChangePassword: true, sessionId: req.admin.sessionId },
      after: { mustChangePassword: false, sessionId: session.sessionId, scope: session.scope, otherSessionsEnded: true },
    });
    return this.sendSession(reply, session);
  }

  private sendSession(reply: FastifyReply, session: IssuedAdminSession): { scope: string } {
    reply.header("set-cookie", buildSessionCookies(session, this.settings.accessTokenSeconds, new Date()));
    return { scope: session.scope };
  }
}
