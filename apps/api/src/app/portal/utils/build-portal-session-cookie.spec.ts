import { buildPortalSessionCookie } from "./build-portal-session-cookie";

// RNX-225: the portal_session cookie's attributes follow lib/auth.ts's defaultCookieAttributes (SameSite=None and
// Secure in production, Lax otherwise) and its Domain getCookieDomain(), as the Better Auth session cookie does.
const SESSION = "11111111-1111-4111-8111-111111111111";
const ENV_KEYS = ["NODE_ENV", "COOKIE_DOMAIN", "API_PUBLIC_URL"] as const;

describe("buildPortalSessionCookie (RNX-225)", () => {
  const saved = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));

  beforeEach(() => {
    delete process.env.COOKIE_DOMAIN;
    delete process.env.API_PUBLIC_URL;
  });

  afterEach(() => {
    for (const key of ENV_KEYS) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
  });

  it("outside production: httpOnly, SameSite=Lax, a year, no Secure, no Domain", () => {
    process.env.NODE_ENV = "development";
    process.env.API_PUBLIC_URL = "https://api.renovix.id";

    expect(buildPortalSessionCookie(SESSION)).toBe(`portal_session=${SESSION}; Path=/; HttpOnly; SameSite=Lax; Max-Age=31536000`);
  });

  it("in production: SameSite=None, Secure, and the Domain derived from API_PUBLIC_URL", () => {
    process.env.NODE_ENV = "production";
    process.env.API_PUBLIC_URL = "https://api.renovix.id";

    expect(buildPortalSessionCookie(SESSION)).toBe(
      `portal_session=${SESSION}; Path=/; HttpOnly; SameSite=None; Max-Age=31536000; Secure; Domain=.renovix.id`,
    );
  });

  it("COOKIE_DOMAIN overrides the derived Domain", () => {
    process.env.NODE_ENV = "production";
    process.env.API_PUBLIC_URL = "https://api.renovix.id";
    process.env.COOKIE_DOMAIN = ".override.test";

    expect(buildPortalSessionCookie(SESSION)).toMatch(/; Domain=\.override\.test$/);
  });
});
