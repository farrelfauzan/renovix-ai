import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { PortalGuard } from "../../app/portal/guard/portal.guard";
import { Access } from "../decorators/access.decorator";
import { AccessMethod } from "../types/access-method";
import { ApiKeyGuard } from "./api-key.guard";
import { CombinedAuthGuard } from "./combined-auth.guard";

/**
 * The methods that carry a credential. A valid one that the route does not
 * list answers 403 instead of 401. `X-Portal-Session` alone is not one: it is
 * an unverified id, not a signed-in user.
 */
const CREDENTIAL_METHODS: readonly AccessMethod[] = ["jwt", "session", "apiKey"];

/**
 * The one global guard (APP_GUARD): reads the route's `@Access` declaration
 * and denies every route that has none. It tries only the listed methods; the
 * existing guards stay the checks behind them and attach what handlers read
 * (`request.user`, `request.portalIdentity`).
 */
@Injectable()
export class AccessGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly combinedAuthGuard: CombinedAuthGuard,
    private readonly apiKeyGuard: ApiKeyGuard,
    private readonly portalGuard: PortalGuard,
  ) {}

  /**
   * 403 without a declaration, or with one this guard cannot check yet
   * (`staff`, `permissions`, `plan`, `reauth`, `webhook`); 401 when no listed
   * method accepts the request; 403 when a method the route does not list does
   * (not on a portal route).
   */
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const access = this.reflector.getAllAndOverride(Access, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!access) throw new ForbiddenException();
    if (access.public) return true;
    const accepted = access.auth ?? [];
    if (
      accepted.includes("staff") ||
      access.permissions?.length ||
      access.plan !== undefined ||
      access.reauth ||
      access.webhook !== undefined
    ) {
      throw new ForbiddenException();
    }
    let rejection: UnauthorizedException | undefined;
    for (const method of accepted) {
      const result = await this.attempt(method, context);
      if (result === true) return true;
      rejection ??= result || undefined;
    }
    // A portal route takes the login JWT or the session as its optional user:
    // without `X-Portal-Session` it answers 401 whatever else the request carries.
    const others = accepted.includes("portal")
      ? []
      : CREDENTIAL_METHODS.filter((method) => !accepted.includes(method));
    for (const method of others) {
      if ((await this.attempt(method, context)) === true) {
        context.switchToHttp().getRequest().user = undefined;
        throw new ForbiddenException();
      }
    }
    throw rejection ?? new UnauthorizedException("Authentication required");
  }

  /** One method's check: true when it accepts the request, otherwise false or the 401 it answered. */
  private async attempt(
    method: AccessMethod,
    context: ExecutionContext,
  ): Promise<boolean | UnauthorizedException> {
    try {
      switch (method) {
        case "jwt":
          return this.combinedAuthGuard.tryJwt(context);
        case "session":
          return await this.combinedAuthGuard.trySession(context);
        case "apiKey":
          return await this.apiKeyGuard.canActivate(context);
        case "portal":
          return await this.portalGuard.canActivate(context);
        default:
          return false; // staff (RX-94): nothing checks it yet
      }
    } catch (err) {
      if (err instanceof UnauthorizedException) return err;
      throw err;
    }
  }
}
