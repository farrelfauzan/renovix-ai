/**
 * RNX-17: the parts of a Fastify request the logger reads: its id and route pattern, and what the guards attach
 * (`user` by CombinedAuthGuard with `userId` and by ApiKeyGuard with `id`, `portalIdentity` by PortalGuard, `admin`
 * by AccessGuard on a `staff` route).
 */
export interface LoggedRequest {
  readonly id: string;
  readonly routeOptions?: { readonly url?: string };
  readonly user?: { readonly userId?: string; readonly id?: string };
  readonly portalIdentity?: { readonly user?: { readonly id?: string } };
  readonly admin?: { readonly adminId?: string };
}
