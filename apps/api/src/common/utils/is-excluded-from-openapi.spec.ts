import { isExcludedFromOpenApi, OPENAPI_EXCLUDED_ROUTES } from "./is-excluded-from-openapi";

describe("isExcludedFromOpenApi", () => {
  it("excludes the webhook provider callbacks with their reason", () => {
    expect(isExcludedFromOpenApi("/api/v1/webhooks/stripe")).toContain("Provider callbacks");
    expect(isExcludedFromOpenApi("/api/v1/webhooks/gowa")).toContain("Provider callbacks");
  });

  it("excludes the infra probes (health and the root route)", () => {
    expect(isExcludedFromOpenApi("/api/health")).toContain("Infra probe");
    expect(isExcludedFromOpenApi("/api/v1")).toContain("Infra probe");
  });

  it("does not exclude any product or back-office route", () => {
    expect(isExcludedFromOpenApi("GET /api/v1/models")).toBeUndefined();
    expect(isExcludedFromOpenApi("POST /api/v1/admin/auth/sign-in")).toBeUndefined();
    expect(isExcludedFromOpenApi("POST /api/v1/chat/completions")).toBeUndefined();
    // A path that merely starts like an excluded one is not excluded.
    expect(isExcludedFromOpenApi("GET /api/v1/webhooks-and-more")).toBeUndefined();
    expect(isExcludedFromOpenApi("GET /api/v1/health")).toBeUndefined();
  });

  it("lists every pattern with a reason", () => {
    expect(OPENAPI_EXCLUDED_ROUTES.length).toBeGreaterThan(0);
    for (const entry of OPENAPI_EXCLUDED_ROUTES) {
      expect(entry.reason.trim().length).toBeGreaterThan(10);
    }
  });
});
