import {
  Injectable,
  CanActivate,
  ExecutionContext,
  UnauthorizedException,
} from "@nestjs/common";
import { auth } from "../../lib/auth";

/**
 * The `session` method of AccessGuard: a Better Auth cookie session (email and password or SSO). The login JWT
 * is not accepted any more (RNX-225).
 *
 * Attaches { userId, email } to request.user for downstream use.
 */
@Injectable()
export class CombinedAuthGuard implements CanActivate {
  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (await this.trySession(context)) {
      return true;
    }

    throw new UnauthorizedException("Authentication required");
  }

  /** Accepts a valid Better Auth cookie session of a user who is not suspended and attaches request.user; false otherwise. */
  async trySession(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    if (request.headers.cookie) {
      try {
        const headers = new Headers();
        for (const [key, value] of Object.entries(request.headers)) {
          if (value) {
            headers.set(
              key,
              Array.isArray(value) ? value.join(", ") : String(value),
            );
          }
        }

        // RNX-336: read the session row on every request instead of trusting the 5-minute cookie cache
        // (lib/auth.ts session.cookieCache), so a revoked session is refused at once.
        const session = await auth.api.getSession({
          headers,
          query: { disableCookieCache: true },
        });
        // RNX-100 (D427): a suspended user's session is refused; the status comes with the session's own user row.
        if (session?.user && session.user.status !== "suspended") {
          request.user = {
            userId: session.user.id,
            email: session.user.email,
          };
          return true;
        }
      } catch {
        // Session invalid
      }
    }
    return false;
  }
}
