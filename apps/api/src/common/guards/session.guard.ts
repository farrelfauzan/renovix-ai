import {
  Injectable,
  CanActivate,
  ExecutionContext,
  UnauthorizedException,
} from "@nestjs/common";
import { auth } from "../../lib/auth";

/**
 * Session-based guard using Better Auth.
 * Validates the session from cookies/headers and attaches user to request.
 * Use this guard alongside or as a replacement for JWT auth.
 */
@Injectable()
export class SessionGuard implements CanActivate {
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();

    // Build headers for Better Auth session validation
    const headers = new Headers();
    for (const [key, value] of Object.entries(request.headers)) {
      if (value) {
        headers.set(
          key,
          Array.isArray(value) ? value.join(", ") : String(value),
        );
      }
    }

    try {
      const session = await auth.api.getSession({ headers });

      if (!session || !session.user) {
        throw new UnauthorizedException("Invalid or expired session");
      }

      // Attach user info to request (compatible with existing req.user format)
      request.user = {
        userId: session.user.id,
        email: session.user.email,
        sessionId: session.session.id,
      };

      return true;
    } catch {
      throw new UnauthorizedException("Invalid or expired session");
    }
  }
}
