import { ForbiddenException, Inject, Injectable, Logger, NotFoundException, UnauthorizedException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type { AdminSession } from "@generated/prisma/client.js";
import * as jwt from "jsonwebtoken";
import { randomBytes, randomUUID } from "node:crypto";
import type { DbTransaction } from "../../prisma/db-transaction";
import { ADMIN_AUTH_CONFIG } from "../config/admin-auth-config.token";
import { AdminSessionRepository } from "../repository/admin-session.repository";
import type { AdminAccessClaims } from "../types/admin-access-claims";
import type { AdminAuthConfig } from "../types/admin-auth-config";
import type { AdminIdentity } from "../types/admin-identity";
import type { IssuedAdminSession } from "../types/issued-admin-session";
import type { StaffRequirement } from "../types/staff-requirement";
import { hasAllPermissions } from "../utils/has-all-permissions";
import { hashToken } from "../utils/hash-token";

/** Audience of the back-office access token: a token for anything else is refused even with the right key. */
const AUDIENCE = "renovix-admin";
const UNAUTHENTICATED = "Authentication required";
const MIN_SECRET_LENGTH = 32;
const REFRESH_TOKEN_BYTES = 32;
const USER_AGENT_MAX_LENGTH = 512;
const MS_PER_MINUTE = 60_000;
const MS_PER_HOUR = 3_600_000;

/** A refresh token: the session id (to find the row) and 32 random bytes. Only its SHA-256 hash is stored. */
const newRefreshToken = (sessionId: string): string =>
  `${sessionId}.${randomBytes(REFRESH_TOKEN_BYTES).toString("base64url")}`;

/**
 * Back-office sessions (RX-94, D54): a 15-minute access token (JWT signed with ADMIN_JWT_SECRET, never
 * JWT_SECRET) renewed by a rotating refresh token; a rotated token used again ends the session; idle and
 * absolute limits checked on every request and on every refresh.
 */
@Injectable()
export class AdminSessionService {
  private readonly logger = new Logger(AdminSessionService.name);
  private readonly secret: string;

  constructor(
    private readonly sessions: AdminSessionRepository,
    config: ConfigService,
    @Inject(ADMIN_AUTH_CONFIG) private readonly settings: AdminAuthConfig,
  ) {
    this.secret = config.getOrThrow<string>("ADMIN_JWT_SECRET");
    if (this.secret.length < MIN_SECRET_LENGTH) {
      throw new Error(`ADMIN_JWT_SECRET must have at least ${MIN_SECRET_LENGTH} characters`);
    }
    if (this.secret === config.get<string>("JWT_SECRET")) throw new Error("ADMIN_JWT_SECRET must not be the same as JWT_SECRET");
  }

  /** Starts a session of this scope ("enrolment" | "full") and returns its tokens. */
  async start(adminId: string, scope: string, userAgent: string | undefined, tx?: DbTransaction): Promise<IssuedAdminSession> {
    const now = new Date();
    const sessionId = randomUUID();
    const refreshToken = newRefreshToken(sessionId);
    const absoluteExpiresAt = new Date(now.getTime() + this.settings.absoluteHours * MS_PER_HOUR);
    await this.sessions.create(
      {
        id: sessionId,
        adminId,
        scope,
        refreshTokenHash: hashToken(refreshToken),
        userAgent: userAgent?.slice(0, USER_AGENT_MAX_LENGTH),
        lastSeenAt: now,
        absoluteExpiresAt,
      },
      tx,
    );
    return { sessionId, scope, accessToken: this.signAccessToken(sessionId, adminId, scope), refreshToken, absoluteExpiresAt };
  }

  /**
   * Rotates the refresh token: 401 for no or an unknown token, or a session that ended (revoked, idle,
   * absolute limit; an ended one is revoked). A token that was already rotated revokes the whole session.
   */
  async refresh(refreshToken: string | undefined): Promise<IssuedAdminSession> {
    const session = refreshToken ? await this.sessions.findWithAdminRole(refreshToken.split(".")[0]) : null;
    if (!refreshToken || !session) throw new UnauthorizedException(UNAUTHENTICATED);
    const presented = hashToken(refreshToken);
    const now = new Date();
    if (session.usedRefreshTokenHashes.includes(presented)) return this.endOnReuse(session.id, now);
    if (session.refreshTokenHash !== presented) throw new UnauthorizedException(UNAUTHENTICATED);
    if (!this.isLive(session, now)) {
      await this.sessions.revoke(session.id, now);
      throw new UnauthorizedException(UNAUTHENTICATED);
    }
    const next = newRefreshToken(session.id);
    const rotated = await this.sessions.rotateRefreshToken(session.id, presented, hashToken(next), now);
    if (rotated === 0) return this.endOnReuse(session.id, now); // the same token was used meanwhile
    return {
      sessionId: session.id,
      scope: session.scope,
      accessToken: this.signAccessToken(session.id, session.adminId, session.scope),
      refreshToken: next,
      absoluteExpiresAt: session.absoluteExpiresAt,
    };
  }

  /**
   * The `staff` check of AccessGuard: 401 without a valid access token of a live session; 403 when the
   * session's scope or its last re-authentication does not meet the route's requirement, or the admin's
   * role lacks one of the route's permissions (read from the database on every request, D60 A4).
   */
  async authenticate(accessToken: string | undefined, requirement: StaffRequirement): Promise<AdminIdentity> {
    const claims = this.readAccessToken(accessToken);
    const session = claims ? await this.sessions.findForAccessCheck(claims.sid) : null;
    const now = new Date();
    if (!claims || !session || session.adminId !== claims.sub || !this.isLive(session, now)) {
      throw new UnauthorizedException(UNAUTHENTICATED);
    }
    this.assertRequirement(session, requirement, now);
    if (!hasAllPermissions(session.permissions, requirement.permissions)) throw new ForbiddenException();
    await this.sessions.touch(session.id, now);
    return { adminId: session.adminId, sessionId: session.id, scope: session.scope, role: session.role };
  }

  /** The admin's live sessions, without token hashes; `current` marks the one making the request. */
  async list(identity: AdminIdentity) {
    const now = new Date();
    const seenAfter = new Date(now.getTime() - this.settings.idleMinutes * MS_PER_MINUTE);
    const rows = await this.sessions.listActiveForAdmin(identity.adminId, now, seenAfter);
    return rows.map((row) => ({ ...row, current: row.id === identity.sessionId }));
  }

  /** Revokes one of the admin's own sessions; 404 for another admin's session or one already ended. */
  async revokeOwn(identity: AdminIdentity, sessionId: string, tx?: DbTransaction): Promise<void> {
    if ((await this.sessions.revokeForAdmin(sessionId, identity.adminId, new Date(), tx)) === 0) throw new NotFoundException();
  }

  /** Ends a session (sign-out, enrolment upgrade). */
  async end(sessionId: string, tx?: DbTransaction): Promise<void> {
    await this.sessions.revoke(sessionId, new Date(), tx);
  }

  /** Records a successful re-authentication on the session. */
  async markReauth(sessionId: string, tx?: DbTransaction): Promise<void> {
    await this.sessions.markReauth(sessionId, new Date(), tx);
  }

  private async endOnReuse(sessionId: string, now: Date): Promise<never> {
    await this.sessions.revoke(sessionId, now);
    this.logger.warn(`Back-office session ${sessionId} ended: a rotated refresh token was used again`);
    throw new UnauthorizedException(UNAUTHENTICATED);
  }

  private isLive(session: Pick<AdminSession, "revokedAt" | "absoluteExpiresAt" | "lastSeenAt">, now: Date): boolean {
    const idleMs = this.settings.idleMinutes * MS_PER_MINUTE;
    return (
      session.revokedAt === null &&
      now.getTime() < session.absoluteExpiresAt.getTime() &&
      now.getTime() - session.lastSeenAt.getTime() <= idleMs
    );
  }

  private assertRequirement(session: Pick<AdminSession, "scope" | "lastReauthAt">, requirement: StaffRequirement, now: Date): void {
    const scopeOk = requirement.scope === "any" || session.scope === (requirement.scope ?? "full");
    if (!scopeOk) throw new ForbiddenException();
    const windowMs = this.settings.reauthWindowMinutes * MS_PER_MINUTE;
    const reauthOk = !requirement.reauth || (session.lastReauthAt !== null && now.getTime() - session.lastReauthAt.getTime() <= windowMs);
    if (!reauthOk) throw new ForbiddenException("Re-authentication required");
  }

  private signAccessToken(sessionId: string, adminId: string, scope: string): string {
    return jwt.sign({ sid: sessionId, scope }, this.secret, {
      algorithm: "HS256",
      audience: AUDIENCE,
      subject: adminId,
      expiresIn: this.settings.accessTokenSeconds,
    });
  }

  private readAccessToken(token: string | undefined): AdminAccessClaims | null {
    if (!token) return null;
    try {
      const payload = jwt.verify(token, this.secret, { algorithms: ["HS256"], audience: AUDIENCE });
      if (typeof payload !== "object" || typeof payload.sid !== "string" || typeof payload.sub !== "string") return null;
      return { sid: payload.sid, sub: payload.sub };
    } catch {
      return null;
    }
  }
}
