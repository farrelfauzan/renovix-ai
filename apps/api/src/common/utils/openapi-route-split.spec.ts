import { isOpenApiBackOfficeRoute, openApiDocumentKind, unassignedOpenApiRoutes, type OpenApiRouteRef } from "./openapi-route-split";

const route = (fullPath: string, label = fullPath): OpenApiRouteRef => ({ fullPath, label });

describe("openApiDocumentKind", () => {
  it("sends every /admin route to backoffice and everything else to portal", () => {
    expect(openApiDocumentKind("/api/v1/admin/auth/sign-in")).toBe("backoffice");
    expect(openApiDocumentKind("/api/v1/admin")).toBe("backoffice");
    expect(openApiDocumentKind("/api/v1/administrivia")).toBe("portal");
    expect(openApiDocumentKind("/api/v1/chat/completions")).toBe("portal");
    expect(isOpenApiBackOfficeRoute("/api/v1/admin/audit-log")).toBe(true);
    expect(isOpenApiBackOfficeRoute("/api/v1/models")).toBe(false);
  });
});

describe("unassignedOpenApiRoutes", () => {
  const none = (): undefined => undefined;

  it("names a route that is in neither document nor on the exclusion list", () => {
    const routes = [route("/api/v1/rogue", "GET /api/v1/rogue (Rogue.leaked)")];
    expect(unassignedOpenApiRoutes(routes, none, new Set())).toEqual(["GET /api/v1/rogue (Rogue.leaked)"]);
  });

  it("reports nothing when every route is documented or excluded", () => {
    const routes = [
      route("/api/v1/admin/auth/sign-in"),
      route("/api/v1/models"),
      route("/api/v1/webhooks/stripe"),
    ];
    const documented = new Set(["/api/v1/admin/auth/sign-in", "/api/v1/models"]);
    const excluded = (path: string): string | undefined => (path === "/api/v1/webhooks/stripe" ? "callback" : undefined);
    expect(unassignedOpenApiRoutes(routes, excluded, documented)).toEqual([]);
  });
});
