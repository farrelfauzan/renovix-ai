import {
  CanActivate,
  ExecutionContext,
  Injectable,
  Logger,
} from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { PortalUserService } from "../service/portal-user.service";
import { auth } from "../../../lib/auth";
import { buildPortalSessionCookie } from "../utils/build-portal-session-cookie";
import { readPortalSessionId } from "../utils/read-portal-session-id";

export interface PortalIdentity {
  sessionId: string;
  tier: "free" | "paid";
  user?: {
    id: string;
    email: string;
    /** The ledger's paid wallet available credits, balance - held (RX-22, D202-2); not User.balance. */
    balance: number;
  };
}

/**
 * The `portal` method of AccessGuard (RNX-225). The portal session is the httpOnly `portal_session` cookie, else
 * the `X-Portal-Session` header (fallback); a request with neither gets a new session id and its cookie (set on
 * the raw response, so it also reaches the SSE responses that write their own headers). The optional signed-in
 * user is the Better Auth session cookie's; a login JWT is never read.
 */
@Injectable()
export class PortalGuard implements CanActivate {
  private readonly logger = new Logger(PortalGuard.name);

  constructor(private readonly portalUsers: PortalUserService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const http = context.switchToHttp();
    const request = http.getRequest();

    // 1. The portal session: the cookie, else the header, else a new one (its cookie goes on the response)
    let sessionId = readPortalSessionId(request.headers);
    if (!sessionId) {
      sessionId = randomUUID();
      http.getResponse().raw.setHeader("set-cookie", buildPortalSessionCookie(sessionId));
    }

    // 2. The signed-in user, if any (Better Auth session)
    const user = request.headers.cookie ? await this.findSessionUser(request.headers) : undefined;

    // 3. Determine tier: paid when the ledger's paid wallet has credits available (RX-22, D202-2)
    const tier: "free" | "paid" = user && user.balance > 0 ? "paid" : "free";

    // 4. Attach portal identity to request
    const identity: PortalIdentity = {
      sessionId,
      tier,
      user,
    };
    request.portalIdentity = identity;

    return true;
  }

  /** The Better Auth session's user, with the paid wallet's available credits; undefined when there is none. */
  private async findSessionUser(
    requestHeaders: Record<string, string | string[] | undefined>,
  ): Promise<PortalIdentity["user"] | undefined> {
    try {
      const headers = new Headers();
      for (const [key, value] of Object.entries(requestHeaders)) {
        if (value) {
          headers.set(
            key,
            Array.isArray(value) ? value.join(", ") : String(value),
          );
        }
      }
      const session = await auth.api.getSession({ headers });
      if (!session?.user) {
        this.logger.debug(
          `Better Auth getSession returned no user (session expired or invalid)`,
        );
        return undefined;
      }
      const dbUser = await this.portalUsers.findPortalUser(session.user.id);
      if (!dbUser) {
        this.logger.warn(
          `Better Auth session valid but user not found in DB: ${session.user.id}`,
        );
        return undefined;
      }
      return {
        id: dbUser.id,
        email: dbUser.email,
        balance: await this.portalUsers.findPaidAvailable(dbUser.id),
      };
    } catch (e) {
      // Invalid session — treat as anonymous
      this.logger.warn(
        `Better Auth session lookup failed: ${e instanceof Error ? e.message : String(e)}`,
      );
      return undefined;
    }
  }
}
