import type { PrismaClient } from "@generated/prisma/client.js";

const HOW_TO =
  "Start it with `docker compose -f docker-compose.test.yml -p renovix-test up -d --wait` and set " +
  "TEST_DATABASE_URL=postgresql://renovix:renovix_test@localhost:55432/renovix_test (docs/testing.md).";

/**
 * Safety rule: tests only ever use TEST_DATABASE_URL, and only when its database
 * name ends in "_test". Anything else is refused before a connection is made.
 */
export function testDatabaseUrl(): string {
  const url = process.env.TEST_DATABASE_URL;
  if (!url) {
    throw new Error(`TEST_DATABASE_URL is not set. ${HOW_TO}`);
  }
  assertTestDatabaseName(new URL(url).pathname.replace(/^\//, ""));
  return url;
}

function assertTestDatabaseName(name: string) {
  if (!name.endsWith("_test")) {
    throw new Error(
      `Refusing to use database "${name}": the test database name must end in "_test". ${HOW_TO}`,
    );
  }
}

/**
 * Empties every table except `_prisma_migrations`. Rows that migrations seed
 * (the three subscription plans) are removed too: create what a test needs
 * with the factories.
 */
export async function resetDatabase(prisma: PrismaClient) {
  const [{ name }] = await prisma.$queryRaw<
    { name: string }[]
  >`SELECT current_database() AS name`;
  assertTestDatabaseName(name);

  const tables = await prisma.$queryRaw<{ tablename: string }[]>`
    SELECT tablename FROM pg_tables
    WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`;
  const list = tables.map((t) => `"public"."${t.tablename}"`).join(", ");
  await prisma.$executeRawUnsafe(`TRUNCATE TABLE ${list} RESTART IDENTITY CASCADE`);
}
