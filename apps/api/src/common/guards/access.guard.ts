import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { ADMIN_COOKIES } from "../../app/admin-auth/config/admin-cookies";
import { AdminSessionService } from "../../app/admin-auth/service/admin-session.service";
import { readCookie } from "../../app/admin-auth/utils/read-cookie";
import { PortalGuard } from "../../app/portal/guard/portal.guard";
import { Access } from "../decorators/access.decorator";
import { AccessMethod } from "../types/access-method";
import { AccessOptions } from "../types/access-options";
import { ApiKeyGuard } from "./api-key.guard";
import { CombinedAuthGuard } from "./combined-auth.guard";

/**
 * The methods that carry a credential. A valid one that the route does not
 * list answers 403 instead of 401. `X-Portal-Session` alone is not one: it is
 * an unverified id, not a signed-in user. A login JWT is no credential at all (RNX-225).
 */
const CREDENTIAL_METHODS: readonly AccessMethod[] = ["session", "apiKey"];

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
    private readonly adminSessions: AdminSessionService,
  ) {}

  /**
   * 403 without a declaration, or with one this guard cannot check yet
   * (`plan`, `webhook`; `permissions`, `reauth` or `staffScope` without
   * `staff`; `staff` next to another method); a `staff` route goes to
   * `attemptStaff`; 401 when no listed method accepts the request; 403 when a
   * method the route does not list does (not on a portal route).
   */
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const access = this.reflector.getAllAndOverride(Access, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!access) throw new ForbiddenException();
    if (access.public) return true;
    const accepted = access.auth ?? [];
    if (access.plan !== undefined || access.webhook !== undefined) {
      throw new ForbiddenException();
    }
    if (accepted.includes("staff")) return this.attemptStaff(access, context);
    // Product permissions are not checked before RX-41: a product route that declares any is refused.
    if (access.permissions?.length || access.reauth || access.staffScope !== undefined) {
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
    await this.refuseOtherCredential(others, context);
    throw rejection ?? new UnauthorizedException("Authentication required");
  }

  /**
   * A back-office route (RX-94): `staff` is its only method. The admin access
   * cookie must name a live session whose scope (and re-authentication, if
   * declared) fits the route, and whose admin's role holds every permission the
   * route declares (RX-96, read on every request): 401 when there is none, 403
   * when it does not fit.
   * Product credentials are not looked at: without a valid admin session the
   * answer is 401 whatever else the request carries, so a back-office client
   * that refreshes on 401 also does so in a browser signed into the product.
   */
  private async attemptStaff(
    access: Extract<AccessOptions, { readonly public?: never }>,
    context: ExecutionContext,
  ): Promise<true> {
    if (access.auth?.length !== 1) throw new ForbiddenException();
    const request = context.switchToHttp().getRequest();
    request.admin = await this.adminSessions.authenticate(
      readCookie(request.headers.cookie, ADMIN_COOKIES.access),
      { scope: access.staffScope, reauth: access.reauth === true, permissions: access.permissions ?? [] },
    );
    return true;
  }

  /** 403 when one of these methods accepts the request (a valid credential of a method the route does not list). */
  private async refuseOtherCredential(
    methods: readonly AccessMethod[],
    context: ExecutionContext,
  ): Promise<void> {
    for (const method of methods) {
      if ((await this.attempt(method, context)) === true) {
        context.switchToHttp().getRequest().user = undefined;
        throw new ForbiddenException();
      }
    }
  }

  /** One method's check: true when it accepts the request, otherwise false or the 401 it answered. */
  private async attempt(
    method: AccessMethod,
    context: ExecutionContext,
  ): Promise<boolean | UnauthorizedException> {
    try {
      switch (method) {
        case "session":
          return await this.combinedAuthGuard.trySession(context);
        case "apiKey":
          return await this.apiKeyGuard.canActivate(context);
        case "portal":
          return await this.portalGuard.canActivate(context);
        default:
          return false; // staff: only through attemptStaff, never next to another method
      }
    } catch (err) {
      if (err instanceof UnauthorizedException) return err;
      throw err;
    }
  }
}
