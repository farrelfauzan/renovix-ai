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
jest.mock("../src/lib/auth", () => ({ auth: { api: { getSession: async () => null } } }));
