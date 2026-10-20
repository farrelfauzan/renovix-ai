import { BadRequestException, Body, Controller, Delete, Header, HttpCode, Inject, Param, Post, Req, Res } from "@nestjs/common";
import { Throttle } from "@nestjs/throttler";
import type { FastifyReply, FastifyRequest } from "fastify";
import { Access } from "../../../common/decorators/access.decorator";
import { ADMIN_AUTH_CONFIG } from "../config/admin-auth-config.token";
import { AdminAudit } from "../decorator/admin-audit.decorator";
import { AcceptInvitationDto } from "../dto/accept-invitation.dto";
import { CreateInvitationDto } from "../dto/create-invitation.dto";
import { InvitationTokenDto } from "../dto/invitation-token.dto";
import { AdminInvitationService } from "../service/admin-invitation.service";
import type { AdminAuthConfig } from "../types/admin-auth-config";
import type { AuditedAdminRequest } from "../types/audited-admin-request";
import { buildSessionCookies } from "../utils/build-session-cookies";

/** Only Owners hold it among the built-in roles (RX-96). */
const ADMIN_WRITE = ["admins:write"];

/**
 * Back-office invitations (RX-95) under /api/v1/admin/invitations. Owners (`admins:write`) create, resend
 * and revoke; the raw link is in the create and resend responses only. The link's holder previews and
 * completes it on the public, rate-limited token routes; the token travels in the body, never the URL.
 */
@Controller("admin/invitations")
export class AdminInvitationsController {
  constructor(
    private readonly invitations: AdminInvitationService,
    @Inject(ADMIN_AUTH_CONFIG) private readonly settings: AdminAuthConfig,
  ) {}

  /** Invites an email with a role. 409 for the email of an admin or of a pending invitation. */
  @Post()
  @Access({ auth: ["staff"], permissions: ADMIN_WRITE })
  @AdminAudit({ resource: "admin_invitation", action: "create" })
  @Header("Cache-Control", "no-store")
  async create(@Body() body: unknown, @Req() req: AuditedAdminRequest) {
    const parsed = CreateInvitationDto.safeParse(body);
    if (!parsed.success) throw new BadRequestException(parsed.error.flatten().fieldErrors);
    const { invitation, link, change } = await this.invitations.create(req.admin.adminId, parsed.data, req.audit.tx);
    req.audit.record(change);
    return { invitation, link };
  }

  /** Revokes the pending invitation's link and returns a new one with a fresh validity. */
  @Post(":id/resend")
  @Access({ auth: ["staff"], permissions: ADMIN_WRITE })
  @AdminAudit({ resource: "admin_invitation", action: "resend" })
  @HttpCode(200)
  @Header("Cache-Control", "no-store")
  async resend(@Param("id") id: string, @Req() req: AuditedAdminRequest) {
    const { invitation, link, change } = await this.invitations.resend(id, req.audit.tx);
    req.audit.record(change);
    return { invitation, link };
  }

  /** Revokes a pending invitation. */
  @Delete(":id")
  @Access({ auth: ["staff"], permissions: ADMIN_WRITE })
  @AdminAudit({ resource: "admin_invitation", action: "revoke" })
  @HttpCode(204)
  async revoke(@Param("id") id: string, @Req() req: AuditedAdminRequest) {
    req.audit.record(await this.invitations.revoke(id, req.audit.tx));
  }

  /** Who invited and with which role. 404 unknown token; 410 used, revoked or expired. */
  @Post("preview")
  @Access({ public: true, reason: "authenticated by the invitation token in the body; the invitee has no account yet" })
  @AdminAudit({ exempt: true, reason: "reads only; POST so the token stays out of the URL and the request logs" })
  @HttpCode(200)
  @Throttle({ default: { ttl: 60000, limit: 10 } })
  async preview(@Body() body: unknown) {
    const parsed = InvitationTokenDto.safeParse(body);
    if (!parsed.success) throw new BadRequestException(parsed.error.flatten().fieldErrors);
    return this.invitations.preview(parsed.data.token);
  }

  /**
   * Completes the invitation: creates the admin (name and password; the email is the invitation's) and sets
   * the cookies of an enrolment session, for TOTP enrolment and the recovery codes. Writes its own audit row
   * (the new admin's), in the transaction that creates the admin.
   */
  @Post("accept")
  @Access({ public: true, reason: "authenticated by the invitation token in the body; the invitee has no account yet" })
  @AdminAudit({ exempt: true, reason: "no signed-in admin yet; the service writes the audit row of the new admin itself" })
  @HttpCode(200)
  @Throttle({ default: { ttl: 60000, limit: 10 } })
  async accept(@Body() body: unknown, @Req() req: FastifyRequest, @Res({ passthrough: true }) reply: FastifyReply) {
    const parsed = AcceptInvitationDto.safeParse(body);
    if (!parsed.success) throw new BadRequestException(parsed.error.flatten().fieldErrors);
    const session = await this.invitations.accept(parsed.data, req.id, req.headers["user-agent"]);
    reply.header("set-cookie", buildSessionCookies(session, this.settings.accessTokenSeconds, new Date()));
    return { scope: session.scope };
  }
}
