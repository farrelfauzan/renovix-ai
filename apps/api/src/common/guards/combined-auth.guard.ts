import {
  Injectable,
  CanActivate,
  ExecutionContext,
  UnauthorizedException,
} from "@nestjs/common";
import * as jwt from "jsonwebtoken";
import { auth } from "../../lib/auth";

/**
 * Combined auth guard that accepts either:
 * 1. JWT Bearer token (legacy email/password flow)
 * 2. Better Auth cookie session (SSO flow)
 *
 * Attaches { userId, email } to request.user for downstream use.
 * Does NOT require JwtModule — uses jsonwebtoken directly.
 */
@Injectable()
export class CombinedAuthGuard implements CanActivate {
  private readonly jwtSecret: string;

  constructor() {
    this.jwtSecret = process.env.JWT_SECRET || "";
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();

    // 1. Try JWT first
    const authHeader = request.headers.authorization;
    if (authHeader && authHeader.startsWith("Bearer ")) {
      const token = authHeader.slice(7);
      try {
        const payload = jwt.verify(token, this.jwtSecret) as any;
        request.user = { userId: payload.userId, email: payload.email };
        return true;
      } catch {
        // JWT invalid — fall through to session check
      }
    }

    // 2. Try Better Auth session (cookie-based)
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
        // Session invalid — fall through
      }
    }

    throw new UnauthorizedException("Authentication required");
  }
}
