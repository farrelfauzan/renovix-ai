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

  /** Accepts a valid Better Auth cookie session and attaches request.user; false otherwise. */
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

        const session = await auth.api.getSession({ headers });
        if (session?.user) {
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
