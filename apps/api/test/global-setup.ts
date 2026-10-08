import { execSync } from "node:child_process";
import { resolve } from "node:path";
import { testDatabaseUrl } from "./test-database";

// Jest globalSetup: migrate the test database once per run. Without
// TEST_DATABASE_URL only the tests that need the database fail (with a hint).
export default function globalSetup() {
  if (!process.env.TEST_DATABASE_URL) {
    console.warn(
      "\n[api tests] TEST_DATABASE_URL is not set: database tests will fail (docs/testing.md).",
    );
    return;
  }
  execSync("npx --no prisma migrate deploy", {
    cwd: resolve(__dirname, "../../.."),
    env: { ...process.env, DATABASE_URL: testDatabaseUrl() },
    stdio: "inherit",
  });
}
