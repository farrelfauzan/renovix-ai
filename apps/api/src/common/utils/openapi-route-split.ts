/**
 * Splits the route table of the real `AppModule` between the two generated OpenAPI documents
 * (RX-170): back-office (`/admin`) and portal (everything else that is not excluded). A route in
 * neither document and not on the exclusion list is a bug: the acceptance criterion says such a
 * route must fail the generator test, so `unassignedOpenApiRoutes` names those routes and the spec
 * asserts the list is empty.
 */

/** A route as the generator sees it: its full path (prefixes included) and a human label. */
export type OpenApiRouteRef = {
  /** The route's full path, `/api` and version prefix included, e.g. "/api/v1/admin/auth/sign-in". */
  readonly fullPath: string;
  /** `METHOD /path (Controller.handler)`, the label the drift report names a route by. */
  readonly label: string;
};

/** The document a route belongs to: `backoffice` (all `/admin` routes) or `portal` (the product API). */
export type OpenApiDocumentKind = "backoffice" | "portal";

/** Whether a route's full path is a back-office route (the back office is /admin and /admin is the back office, RX-96). */
export function isOpenApiBackOfficeRoute(fullPath: string): boolean {
  return /^\/api\/v1\/admin(\/|$)/.test(fullPath);
}

/** The document a route's full path belongs to: every `/admin` route is back-office, everything else portal. */
export function openApiDocumentKind(fullPath: string): OpenApiDocumentKind {
  return isOpenApiBackOfficeRoute(fullPath) ? "backoffice" : "portal";
}

/**
 * The labels of the routes that are in neither generated document nor on the exclusion list — a
 * bug the generator test fails on. `documentedPaths` is the union of both documents' path keys, so
 * a route the builder dropped (or a controller nobody wired up) is named here.
 */
export function unassignedOpenApiRoutes(
  routes: readonly OpenApiRouteRef[],
  isExcluded: (fullPath: string) => string | undefined,
  documentedPaths: ReadonlySet<string>,
): string[] {
  return routes
    .filter(({ fullPath }) => isExcluded(fullPath) === undefined && !documentedPaths.has(fullPath))
    .map(({ label }) => label)
    .sort();
}
