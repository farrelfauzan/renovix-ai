/** A route path whose first segment is `admin`. */
const ADMIN_PATH = /^\/*admin(\/|$)/;

/**
 * True when a route is an /admin route (RX-156): its controller path joined with its handler path (Nest's
 * path metadata, without the global prefix and version) starts with the segment `admin`. Each may list several paths.
 */
export function isAdminRoute(controllerPath: string | string[], handlerPath: string | string[]): boolean {
  return [controllerPath].flat().some((base) => [handlerPath].flat().some((path) => ADMIN_PATH.test(`${base}/${path}`.replace(/^\/+/, ""))));
}
