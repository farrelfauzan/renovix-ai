// The real better-auth and lib/auth in a spec (RNX-168), for its jest.mock factories. better-auth is ESM-only:
// Jest's CommonJS runtime cannot load it, Node's own require can (require(esm), Node 22.12 and later). A spec
// mocks "better-auth" with `betterAuthWithLimiter()`, "better-auth/adapters/prisma" with `requireNative(...)`
// and lib/auth (which setup-env.ts mocks) with `loadLibAuth(...)`. This file imports nothing of the app: the
// factories run while the app's modules are still loading.

/** A module loaded by Node's own require, not Jest's (whose `require("node:module")` is its own). */
export const requireNative = (id: string): unknown =>
  process.getBuiltinModule("node:module").createRequire(__filename)(id);

/**
 * better-auth with its rate limiter on (by default it is on only in production): production's 3 calls for
 * /sign-in/email and /sign-up/email, but over 60 seconds instead of 10, so a slow run cannot reset a bucket.
 * Every other option is lib/auth's own.
 */
export function betterAuthWithLimiter(): object {
  const actual = requireNative("better-auth") as { betterAuth: (options: object) => unknown };
  const rule = { window: 60, max: 3 };
  return {
    ...actual,
    betterAuth: (options: object) =>
      actual.betterAuth({ ...options, rateLimit: { enabled: true, customRules: { "/sign-in/email": rule, "/sign-up/email": rule } } }),
  };
}

/**
 * The real lib/auth, loaded with CLIENT_IP_HEADER set to `clientIpHeader` (or unset): it reads its environment
 * when it loads, so one spec file covers one value (loading it twice in one file loads the Prisma client
 * twice, which its query engine does not survive).
 */
export function loadLibAuth(clientIpHeader?: string): unknown {
  if (clientIpHeader) process.env.CLIENT_IP_HEADER = clientIpHeader;
  else delete process.env.CLIENT_IP_HEADER;
  process.env.BETTER_AUTH_SECRET = "rnx168-test-better-auth-secret-not-a-real-secret";
  return jest.requireActual("../src/lib/auth");
}
