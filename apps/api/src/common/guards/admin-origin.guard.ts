import { CanActivate, ExecutionContext, ForbiddenException, Inject, Injectable } from "@nestjs/common";
import { PATH_METADATA } from "@nestjs/common/constants";
import { Reflector } from "@nestjs/core";
import type { FastifyRequest } from "fastify";
import { ADMIN_ORIGIN } from "../../app/admin-auth/config/admin-origin.token";
import { isAdminRoute } from "../../app/admin-auth/utils/is-admin-route";
import { isAllowedAdminOrigin } from "../../app/admin-auth/utils/is-allowed-admin-origin";

/**
 * The back-office has its own origin (RX-156, D117 item 73). A global guard (APP_GUARD) registered before
 * the throttler and AccessGuard: every route whose controller and handler path start with `admin` answers
 * 403 to an Origin that is not exactly ADMIN_ORIGIN, and to a POST, PUT, PATCH or DELETE without Origin,
 * before any other guard, pipe or handler runs. Every other route passes untouched.
 */
@Injectable()
export class AdminOriginGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    @Inject(ADMIN_ORIGIN) private readonly adminOrigin: string,
  ) {}

  /** True on a non-/admin route and on an allowed /admin request; otherwise 403. */
  canActivate(context: ExecutionContext): boolean {
    const controllerPath = this.reflector.get<string | string[]>(PATH_METADATA, context.getClass());
    const handlerPath = this.reflector.get<string | string[]>(PATH_METADATA, context.getHandler());
    if (!isAdminRoute(controllerPath, handlerPath)) return true;
    const request = context.switchToHttp().getRequest<FastifyRequest>();
    if (!isAllowedAdminOrigin(request.headers.origin, request.method, this.adminOrigin)) throw new ForbiddenException();
    return true;
  }
}
