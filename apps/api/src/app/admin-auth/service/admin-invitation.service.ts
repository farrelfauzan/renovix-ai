import { ConflictException, GoneException, Inject, Injectable, Logger, NotFoundException } from "@nestjs/common";
import type { DbTransaction } from "../../prisma/db-transaction";
import { TransactionService } from "../../prisma/transaction.service";
import { ADMIN_ORIGIN } from "../config/admin-origin.token";
import { INVITATION_TTL_HOURS } from "../config/invitation-ttl";
import type { AcceptInvitationDto } from "../dto/accept-invitation.dto";
import type { CreateInvitationDto } from "../dto/create-invitation.dto";
import { AdminAuditLogRepository } from "../repository/admin-audit-log.repository";
import { AdminInvitationRepository } from "../repository/admin-invitation.repository";
import { AdminUserRepository } from "../repository/admin-user.repository";
import type { AdminAuditChange } from "../types/admin-audit-change";
import type { InvitationPreview } from "../types/invitation-preview";
import type { IssuedAdminSession } from "../types/issued-admin-session";
import type { IssuedInvitation } from "../types/issued-invitation";
import { buildInvitationLink } from "../utils/build-invitation-link";
import { describeInvitation } from "../utils/describe-invitation";
import { findInvitationProblem } from "../utils/find-invitation-problem";
import { hashToken } from "../utils/hash-token";
import { newInvitationToken } from "../utils/new-invitation-token";
import { AdminSessionService } from "./admin-session.service";
import { PasswordService } from "./password.service";

const MS_PER_HOUR = 3_600_000;
const NOT_FOUND = "Invitation not found";

/**
 * Back-office invitations (RX-95): an Owner invites an email with a role; the AdminUser row is created only
 * when the link is completed. The link's token is single-use, valid INVITATION_TTL_HOURS, and only its
 * SHA-256 hash is stored; the raw link is returned once, in the create (or resend) response. Logs and audit
 * rows carry only the invitation id and the email.
 */
@Injectable()
export class AdminInvitationService {
  private readonly logger = new Logger(AdminInvitationService.name);

  constructor(
    private readonly invitations: AdminInvitationRepository,
    private readonly admins: AdminUserRepository,
    private readonly auditLog: AdminAuditLogRepository,
    private readonly passwords: PasswordService,
    private readonly sessions: AdminSessionService,
    private readonly transactions: TransactionService,
    @Inject(ADMIN_ORIGIN) private readonly adminOrigin: string,
  ) {}

  /** Invites the email: 409 for the email of an admin or of a pending invitation, 400 for an unknown role. */
  async create(inviterAdminId: string, input: CreateInvitationDto, tx: DbTransaction): Promise<IssuedInvitation> {
    const email = input.email.trim().toLowerCase();
    if (await this.admins.findByEmail(email, tx)) throw new ConflictException("An admin with this email already exists");
    const issued = await this.issue({ email, role: input.role, invitedByAdminId: inviterAdminId }, tx);
    return { ...issued, change: { before: {}, after: describeInvitation(issued.invitation) } };
  }

  /** Revokes the pending invitation's link and issues a new one, valid INVITATION_TTL_HOURS again. 404 when not pending. */
  async resend(invitationId: string, tx: DbTransaction): Promise<IssuedInvitation> {
    const old = await this.invitations.findById(invitationId, tx);
    if (!old || (await this.invitations.revokePending(old.id, new Date(), tx)) === 0) throw new NotFoundException(NOT_FOUND);
    const issued = await this.issue({ email: old.email, role: old.role, invitedByAdminId: old.invitedByAdminId }, tx);
    const after = { ...describeInvitation(issued.invitation), revokedInvitationId: old.id };
    return { ...issued, change: { before: describeInvitation(old), after } };
  }

  /** Revokes a pending invitation. 404 when it is not pending. */
  async revoke(invitationId: string, tx: DbTransaction): Promise<AdminAuditChange> {
    const invitation = await this.invitations.findById(invitationId, tx);
    if (!invitation || (await this.invitations.revokePending(invitation.id, new Date(), tx)) === 0) {
      throw new NotFoundException(NOT_FOUND);
    }
    return { before: describeInvitation(invitation), after: { ...describeInvitation(invitation), revoked: true } };
  }

  /** Who invited and with which role, for the link's holder. 404 unknown token; 410 used, revoked or expired. */
  async preview(token: string): Promise<InvitationPreview> {
    const invitation = await this.findUsable(token);
    return { email: invitation.email, role: invitation.role, invitedBy: invitation.invitedBy, expiresAt: invitation.expiresAt };
  }

  /**
   * Completes the invitation: creates the admin with the invitation's email and role, the given name and
   * password, and starts an enrolment session (TOTP enrolment and the recovery codes follow on the RX-94
   * enrolment routes). One transaction: the conditional claim of the token, the admin row, its audit row and
   * the session; a used, revoked or expired link (also one used by a parallel completion) creates nothing.
   */
  async accept(input: AcceptInvitationDto, requestId: string, userAgent: string | undefined): Promise<IssuedAdminSession> {
    const invitation = await this.findUsable(input.token);
    this.passwords.assertAcceptable(input.password, invitation.email);
    const passwordHash = await this.passwords.hash(input.password);
    return this.transactions.run(async (tx) => {
      const now = new Date();
      if ((await this.invitations.claim(invitation.id, now, tx)) === 0) throw new GoneException("This invitation link is no longer valid");
      const admin = await this.admins.create({ email: invitation.email, role: invitation.role, name: input.name, passwordHash }, tx);
      await this.auditLog.create(
        {
          adminId: admin.id,
          resource: "admin_invitation",
          action: "accept",
          before: { invitationId: invitation.id, status: "pending" },
          after: { invitationId: invitation.id, status: "used", adminId: admin.id, email: admin.email, role: admin.role },
          reason: "",
          requestId,
          effectiveAt: now,
        },
        tx,
      );
      this.logger.log(`Back-office invitation ${invitation.id} completed for ${invitation.email}`);
      return this.sessions.start(admin.id, "enrolment", userAgent, tx);
    });
  }

  private async issue(
    data: { email: string; role: string; invitedByAdminId: string },
    tx: DbTransaction,
  ): Promise<Omit<IssuedInvitation, "change">> {
    const token = newInvitationToken();
    const expiresAt = new Date(Date.now() + INVITATION_TTL_HOURS * MS_PER_HOUR);
    const invitation = await this.invitations.create({ ...data, tokenHash: hashToken(token), expiresAt }, tx);
    this.logger.log(`Back-office invitation ${invitation.id} issued for ${invitation.email}`);
    return { invitation, link: buildInvitationLink(this.adminOrigin, token) };
  }

  private async findUsable(token: string) {
    const invitation = await this.invitations.findByTokenHash(hashToken(token));
    if (!invitation) throw new NotFoundException(NOT_FOUND);
    const problem = findInvitationProblem(invitation, new Date());
    if (problem) throw new GoneException(problem);
    return invitation;
  }
}
