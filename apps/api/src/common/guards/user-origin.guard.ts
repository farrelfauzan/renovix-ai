import { CanActivate, ExecutionContext, ForbiddenException, Inject, Injectable } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import type { FastifyRequest } from "fastify";
import { ALLOWED_ORIGINS } from "../config/allowed-origins.token";
import { Access } from "../decorators/access.decorator";
import { AccessMethod } from "../types/access-method";
import { isAllowedUserOrigin } from "../utils/is-allowed-user-origin";

/** The sign-in methods a browser sends by cookie, so a foreign page's write would carry them (RNX-272). */
const COOKIE_METHODS: readonly AccessMethod[] = ["session", "portal"];

/**
 * The user routes' Origin check (RNX-272). The session and portal cookies are SameSite=None in production, and a
 * cross-site multipart or form POST needs no CORS preflight, so the browser sends them with a foreign page's write.
 * A global guard (APP_GUARD) registered right after AdminOriginGuard, before the throttler and AccessGuard: on a
 * route whose `@Access` lists `session` or `portal` (read as AccessGuard reads it), a POST, PUT, PATCH or DELETE
 * answers 403 unless its Origin, or without one its Referer's origin, is in `resolveCorsOrigins(process.env)`
 * (main.ts's CORS list). With neither header it answers 403. That list is `true` only in development and test with
 * CORS_ORIGIN unset (RNX-70), and then every request passes. Reads, public routes (webhooks, Better Auth), API key and
 * `staff` routes (AdminOriginGuard) pass untouched.
 */
@Injectable()
export class UserOriginGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    @Inject(ALLOWED_ORIGINS) private readonly allowedOrigins: readonly string[] | true,
  ) {}

  /** True on a route without a cookie sign-in method and on an allowed request; otherwise 403. */
  canActivate(context: ExecutionContext): boolean {
    const access = this.reflector.getAllAndOverride(Access, [context.getHandler(), context.getClass()]);
    if (access?.public || !access?.auth?.some((method) => COOKIE_METHODS.includes(method))) return true;
    const request = context.switchToHttp().getRequest<FastifyRequest>();
    const { origin, referer } = request.headers;
    if (!isAllowedUserOrigin({ method: request.method, origin, referer, allowedOrigins: this.allowedOrigins })) {
      throw new ForbiddenException();
    }
    return true;
  }
}
