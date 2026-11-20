import { HttpException, Injectable } from "@nestjs/common";
import { auth } from "../../../lib/auth";
import { SessionRepository } from "../repository/session.repository";
import { describeDevice } from "../utils/describe-device";
import type { SessionView } from "../types/session-view";

/**
 * RNX-78: Settings > Sign-in and security, the parts Better Auth's own endpoints cannot serve to the browser: the
 * session list without tokens, and a first password for an account that signed up with Google or GitHub (Better
 * Auth's setPassword is server-only). Email change, password change, linking and "Sign out others" are Better Auth's
 * own endpoints. Nothing is kept in memory, so any number of API containers can answer.
 */
@Injectable()
export class SignInSecurityService {
  /** Better Auth's server API (lib/auth.ts is outside Nest DI). */
  private readonly authApi = auth.api;

  constructor(private readonly sessions: SessionRepository) {}

  /** This user's active sessions (device, last active, which one is this request's), never a token or IP address. */
  async listSessions(headers: Headers, userId: string): Promise<SessionView[]> {
    const current = await this.authApi.getSession({ headers, query: { disableCookieCache: true } });
    const rows = await this.sessions.findActiveSessions(userId, new Date());
    return rows.map((row) => ({
      id: row.id,
      device: describeDevice(row.userAgent),
      lastActiveAt: row.updatedAt,
      isCurrent: row.id === current?.session.id,
    }));
  }

  /**
   * Sets the first password of the session's user through Better Auth (it hashes it and adds the credential account).
   * Refused with Better Auth's answer (400 PASSWORD_ALREADY_SET) when the account already has a password.
   */
  async setPassword(headers: Headers, newPassword: string): Promise<void> {
    const response = await this.authApi.setPassword({ body: { newPassword }, headers, asResponse: true });
    if (!response.ok) throw new HttpException((await response.json()) as Record<string, unknown>, response.status);
  }
}
