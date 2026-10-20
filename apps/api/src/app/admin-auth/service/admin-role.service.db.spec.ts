import { BadRequestException, ConflictException, ForbiddenException, NotFoundException } from "@nestjs/common";
import { TestingModule } from "@nestjs/testing";
import { PrismaService } from "../../prisma/prisma.service";
import { createTestModule } from "../../../../test/test-module";
import { resetDatabase } from "../../../../test/test-database";
import { seedAdminRoles } from "../../../../test/admin-auth";
import { AdminRoleService } from "./admin-role.service";

// RX-96: role assignment keeps at least one owner (PRD 09 F3, F5), on the test database.
const PARALLEL_ROUNDS = 10;
/** The admin making the change in these tests (RX-95: never the target); not stored by assignRole. */
const ACTOR = "00000000-0000-4000-8000-0000000000ac";

describe("AdminRoleService.assignRole (RX-96, test database)", () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let roles: AdminRoleService;

  beforeAll(async () => {
    ({ moduleRef, prisma } = await createTestModule({ providers: [AdminRoleService] }));
    roles = moduleRef.get(AdminRoleService);
  });

  beforeEach(async () => {
    await resetDatabase(prisma);
    await seedAdminRoles(prisma);
  });

  afterAll(() => moduleRef?.close());

  const createAdmin = (email: string, role: string) =>
    prisma.adminUser.create({ data: { email, passwordHash: "not-used", role } });
  const roleOf = async (id: string) => (await prisma.adminUser.findUniqueOrThrow({ where: { id } })).role;
  const ownerCount = () => prisma.adminUser.count({ where: { role: "owner" } });

  it("moves an admin to another role", async () => {
    const admin = await createAdmin("ops@example.com", "operations");

    await roles.assignRole(admin.id, "finance", ACTOR);

    expect(await roleOf(admin.id)).toBe("finance");
  });

  it("demotes one of two owners", async () => {
    const first = await createAdmin("a@example.com", "owner");
    await createAdmin("b@example.com", "owner");

    await roles.assignRole(first.id, "viewer", ACTOR);

    expect(await roleOf(first.id)).toBe("viewer");
    expect(await ownerCount()).toBe(1);
  });

  it("the last owner: 409, role unchanged", async () => {
    const owner = await createAdmin("a@example.com", "owner");
    await createAdmin("ops@example.com", "operations");

    await expect(roles.assignRole(owner.id, "operations", ACTOR)).rejects.toBeInstanceOf(ConflictException);

    expect(await roleOf(owner.id)).toBe("owner");
  });

  it("RX-95: the last active owner (the other owner suspended): 409, role unchanged", async () => {
    const owner = await createAdmin("a@example.com", "owner");
    const suspended = await createAdmin("b@example.com", "owner");
    await prisma.adminUser.update({ where: { id: suspended.id }, data: { suspendedAt: new Date() } });

    await expect(roles.assignRole(owner.id, "viewer", ACTOR)).rejects.toBeInstanceOf(ConflictException);

    expect(await roleOf(owner.id)).toBe("owner");
  });

  it("RX-95: a suspended owner may be demoted while one owner stays active", async () => {
    await createAdmin("a@example.com", "owner");
    const suspended = await createAdmin("b@example.com", "owner");
    await prisma.adminUser.update({ where: { id: suspended.id }, data: { suspendedAt: new Date() } });

    await roles.assignRole(suspended.id, "viewer", ACTOR);

    expect(await roleOf(suspended.id)).toBe("viewer");
  });

  it("RNX-187: with a single (active) owner, another admin's role can be changed", async () => {
    const owner = await createAdmin("a@example.com", "owner");
    const ops = await createAdmin("ops@example.com", "operations");

    await roles.assignRole(ops.id, "finance", owner.id);

    expect([await roleOf(owner.id), await roleOf(ops.id)]).toEqual(["owner", "finance"]);
  });

  it("RX-95: an admin cannot change their own role (self-demotion): 403, role unchanged", async () => {
    const owner = await createAdmin("a@example.com", "owner");
    await createAdmin("b@example.com", "owner");

    await expect(roles.assignRole(owner.id, "viewer", owner.id)).rejects.toBeInstanceOf(ForbiddenException);

    expect(await roleOf(owner.id)).toBe("owner");
  });

  it("the last owner keeping owner: allowed (no change)", async () => {
    const owner = await createAdmin("a@example.com", "owner");

    await roles.assignRole(owner.id, "owner", ACTOR);

    expect(await roleOf(owner.id)).toBe("owner");
  });

  it("promoting to owner, then the first owner may step down", async () => {
    const owner = await createAdmin("a@example.com", "owner");
    const ops = await createAdmin("ops@example.com", "operations");
    await roles.assignRole(ops.id, "owner", ACTOR);

    await roles.assignRole(owner.id, "viewer", ACTOR);

    expect([await roleOf(owner.id), await roleOf(ops.id)]).toEqual(["viewer", "owner"]);
  });

  it("an unknown role: 400, role unchanged", async () => {
    const admin = await createAdmin("ops@example.com", "operations");

    await expect(roles.assignRole(admin.id, "superuser", ACTOR)).rejects.toBeInstanceOf(BadRequestException);

    expect(await roleOf(admin.id)).toBe("operations");
  });

  it("an unknown admin: 404", async () => {
    await createAdmin("a@example.com", "owner");

    await expect(roles.assignRole("00000000-0000-4000-8000-000000000000", "viewer", ACTOR)).rejects.toBeInstanceOf(NotFoundException);
  });

  it(`two parallel demotions of the only two owners: one succeeds, one gets 409, one owner left (${PARALLEL_ROUNDS} rounds)`, async () => {
    for (let round = 0; round < PARALLEL_ROUNDS; round++) {
      await prisma.adminUser.deleteMany();
      const first = await createAdmin(`a${round}@example.com`, "owner");
      const second = await createAdmin(`b${round}@example.com`, "owner");

      const results = await Promise.allSettled([roles.assignRole(first.id, "viewer", ACTOR), roles.assignRole(second.id, "viewer", ACTOR)]);

      const fulfilled = results.filter((result) => result.status === "fulfilled");
      const rejected = results.flatMap((result) => (result.status === "rejected" ? [result.reason] : []));
      expect(fulfilled).toHaveLength(1);
      expect(rejected).toHaveLength(1);
      expect(rejected[0]).toBeInstanceOf(ConflictException);
      expect(await ownerCount()).toBe(1);
    }
  });
});
