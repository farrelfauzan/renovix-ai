import { testDatabaseUrl } from "./test-database";

// Runs before every test file. The app reads DATABASE_URL, so it must never
// point at a developer or production database during tests: it is the checked
// test database, or an address where nothing listens.
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL
  ? testDatabaseUrl()
  : "postgresql://none@127.0.0.1:1/no_test_database_test";

// Every test module has the global AccessGuard (test-module.ts). Its JWT check
// needs a secret (a spec may set its own before it builds its module), and its
// session check loads better-auth, which is ESM-only: no session, unless the
// spec mocks lib/auth itself.
process.env.JWT_SECRET = "test-jwt-secret";
// AccessGuard's staff method and the back-office sign-in (RX-94) need their own keys, with no
// fallback: obviously fake test values (a spec may set its own before it builds its module).
process.env.ADMIN_JWT_SECRET = "test-admin-jwt-secret-not-a-real-secret";
process.env.ADMIN_TOTP_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("base64");
// MCP credential encryption (RX-110): required, no fallback; an obviously fake 32-byte test key.
process.env.MCP_ENCRYPTION_KEY = Buffer.alloc(32, 9).toString("hex");
// The back-office origin (RX-156): /admin routes refuse any other Origin; obviously fake.
process.env.ADMIN_ORIGIN = "http://admin.renovix.test";
// MCP OAuth state signing (RX-151): required, no fallback; an obviously fake test value.
process.env.MCP_OAUTH_STATE_SECRET = "test-mcp-oauth-state-secret-not-a-real-secret";
// Provider key encryption (RX-177): required, no fallback; an obviously fake 32-byte test key.
process.env.LLM_KEY_ENCRYPTION_KEY = Buffer.alloc(32, 11).toString("hex");
// API key hashing (RNX-18): required, no fallback; an obviously fake test value (createApiKey in factories.ts uses it).
process.env.API_KEY_HASH_SECRET = "test-api-key-hash-secret-not-a-real-secret";
jest.mock("../src/lib/auth", () => ({ auth: { api: { getSession: async () => null } } }));
