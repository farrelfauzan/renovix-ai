import { resolveTrustedOrigins } from "./resolve-trusted-origins";

// RNX-277: Better Auth's trusted origins are the same allowed-origins list as CORS and UserOriginGuard
// (resolveCorsOrigins), with no localhost fallback outside development and test.
describe("resolveTrustedOrigins (RNX-277)", () => {
  const PROD = { NODE_ENV: "production" } as NodeJS.ProcessEnv;

  it("production with CORS_ORIGIN set: exactly the CORS list (plus ADMIN_ORIGIN), no localhost", () => {
    const origins = resolveTrustedOrigins({
      ...PROD,
      CORS_ORIGIN: "https://chat.renovix.id,https://landing.renovix.id",
      ADMIN_ORIGIN: "https://admin.renovix.id",
    });

    expect(origins).toEqual([
      "https://chat.renovix.id",
      "https://landing.renovix.id",
      "https://admin.renovix.id",
    ]);
    expect(origins).not.toContain("http://localhost:4200");
  });

  it("production without CORS_ORIGIN: throws (resolveCorsOrigins refuses first); never a localhost fallback", () => {
    expect(() => resolveTrustedOrigins({ ...PROD })).toThrow(/CORS_ORIGIN is required/);
  });

  it("production with an unset DASHBOARD_URL / CHAT_APP_URL / APP_BASE_URL trusts no localhost origin", () => {
    const origins = resolveTrustedOrigins({
      ...PROD,
      CORS_ORIGIN: "https://chat.renovix.id",
      // none of the old variables is set
    });

    expect(origins).toEqual(["https://chat.renovix.id"]);
    expect(origins.some((o) => o.includes("localhost"))).toBe(false);
  });

  it("development with CORS_ORIGIN unset: the local origins a developer's apps use, plus API_PUBLIC_URL's origin", () => {
    const origins = resolveTrustedOrigins({ NODE_ENV: "development", API_PUBLIC_URL: "http://localhost:3000" });

    expect(origins).toEqual(["http://localhost:3000", "http://localhost:4200", "http://localhost:4201"]);
  });

  it("test mode with CORS_ORIGIN unset: localhost origins (local sign-in still works)", () => {
    expect(resolveTrustedOrigins({ NODE_ENV: "test" })).toEqual([
      "http://localhost:3000",
      "http://localhost:4200",
      "http://localhost:4201",
    ]);
  });
});
