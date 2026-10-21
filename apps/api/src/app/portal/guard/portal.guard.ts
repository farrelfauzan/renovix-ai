import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
  Logger,
} from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import { API_KEY_FORMAT } from "../../auth/config/api-key-format";
import { PortalUserService } from "../service/portal-user.service";
import { auth } from "../../../lib/auth";

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

@Injectable()
export class PortalGuard implements CanActivate {
  private readonly logger = new Logger(PortalGuard.name);

  constructor(
    private readonly jwtService: JwtService,
    private readonly portalUsers: PortalUserService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();

    // 1. Session token is always required
    const sessionToken = request.headers["x-portal-session"];
    if (!sessionToken || typeof sessionToken !== "string") {
      throw new UnauthorizedException("Missing X-Portal-Session header");
    }

    // 2. Try to extract user identity (JWT or Better Auth session)
    const authHeader = request.headers.authorization;
    let user: PortalIdentity["user"] | undefined;

    if (authHeader && authHeader.startsWith("Bearer ")) {
      const token = authHeader.slice(7);
      // Skip if it looks like an API key (RNX-18: rnx_live_)
      if (!token.startsWith(API_KEY_FORMAT.marker)) {
        try {
          const payload = this.jwtService.verify(token);
          const dbUser = await this.portalUsers.findPortalUser(
            payload.userId,
          );
          if (dbUser) {
            user = {
              id: dbUser.id,
              email: dbUser.email,
              balance: await this.portalUsers.findPaidAvailable(dbUser.id),
            };
          }
        } catch (e) {
          // Invalid JWT — treat as anonymous (free tier)
          this.logger.warn(`JWT verification failed: ${e?.message || e}`);
        }
      }
    }

    // 2b. If no JWT user, try Better Auth cookie session
    if (!user && request.headers.cookie) {
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
          const dbUser = await this.portalUsers.findPortalUser(
            session.user.id,
          );
          if (dbUser) {
            user = {
              id: dbUser.id,
              email: dbUser.email,
              balance: await this.portalUsers.findPaidAvailable(dbUser.id),
            };
          } else {
            this.logger.warn(
              `Better Auth session valid but user not found in DB: ${session.user.id}`,
            );
          }
        } else {
          this.logger.debug(
            `Better Auth getSession returned no user (session expired or invalid)`,
          );
        }
      } catch (e) {
        // Invalid session — treat as anonymous
        this.logger.warn(
          `Better Auth session lookup failed: ${e?.message || e}`,
        );
      }
    }

    // 3. Determine tier: paid when the ledger's paid wallet has credits available (RX-22, D202-2)
    const tier: "free" | "paid" = user && user.balance > 0 ? "paid" : "free";

    // 4. Attach portal identity to request
    const identity: PortalIdentity = {
      sessionId: sessionToken,
      tier,
      user,
    };
    request.portalIdentity = identity;

    return true;
  }
}
