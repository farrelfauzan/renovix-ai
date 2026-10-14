import { TestingModule } from "@nestjs/testing";
import { PrismaService } from "../../prisma/prisma.service";
import { createTestModule } from "../../../../test/test-module";
import { resetDatabase } from "../../../../test/test-database";
import { seedAdminRoles } from "../../../../test/admin-auth";
import { BUILT_IN_ROLES } from "./built-in-roles";
import { STAFF_PERMISSIONS } from "./staff-permissions";

// RX-96: the built-in roles the migration seeds (its INSERT, run by seedAdminRoles) are PRD 09 F5's table.
const READS = [
  "users:read",
  "companies:read",
  "enterprise_requests:read",
  "guardrails:read",
  "models:read",
  "providers:read",
  "packages:read",
  "credits:read",
  "usage:read",
  "admins:read",
  "roles:read",
  "settings:read",
];
const EXPECTED: Record<string, string[]> = {
  // "Everything, including roles, admins, provider keys and settings."
  owner: [...STAFF_PERMISSIONS],
  // "Users, companies, Enterprise requests, guardrails, models; no credit adjustments, no provider keys." + D56 reveal.
  operations: [
    "users:read", "users:read_pii", "users:write", "companies:read", "companies:write", "enterprise_requests:read",
    "enterprise_requests:write", "guardrails:read", "guardrails:write", "models:read", "models:write",
  ],
  // "Packages, credits, adjustments, usage and cost, exports; read-only elsewhere."
  finance: [
    ...READS, "packages:write", "credits:adjust", "exports:create",
  ],
  // "Users and companies with personal data masked, read-only; can open a support note."
  support: ["users:read", "companies:read", "support_notes:write"],
  // "Read-only everywhere, personal data masked."
  viewer: READS,
};

describe("built-in roles (RX-96, PRD 09 F5, test database)", () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;

  beforeAll(async () => {
    ({ moduleRef, prisma } = await createTestModule({}));
    await resetDatabase(prisma);
    await seedAdminRoles(prisma);
  });

  afterAll(() => moduleRef?.close());

  it("the five built-in roles, each with F5's permissions", async () => {
    const rows = await prisma.adminRole.findMany({ orderBy: { name: "asc" } });

    const actual = Object.fromEntries(rows.map((row) => [row.name, [...row.permissions].sort()]));
    const expected = Object.fromEntries(Object.entries(EXPECTED).map(([name, list]) => [name, [...list].sort()]));
    expect(actual).toEqual(expected);
    expect(rows.every((row) => row.builtIn)).toBe(true);
    expect(rows.map((row) => row.name).sort()).toEqual(Object.values(BUILT_IN_ROLES).sort());
  });

  it("every seeded permission is a staff permission", async () => {
    const rows = await prisma.adminRole.findMany();

    const unknown = rows.flatMap((row) => row.permissions.filter((p) => !(STAFF_PERMISSIONS as readonly string[]).includes(p)));
    expect(unknown).toEqual([]);
  });

  it("only owner and operations hold users:read_pii (D56)", async () => {
    const rows = await prisma.adminRole.findMany({ where: { permissions: { has: "users:read_pii" } } });

    expect(rows.map((row) => row.name).sort()).toEqual(["operations", "owner"]);
  });

  it("every staff permission is a resource:action pair, listed once", () => {
    expect(STAFF_PERMISSIONS.filter((p) => !/^[a-z_]+:[a-z_]+$/.test(p))).toEqual([]);
    expect(new Set(STAFF_PERMISSIONS).size).toBe(STAFF_PERMISSIONS.length);
  });
});
