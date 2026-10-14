import { BadRequestException, ConflictException, NotFoundException } from "@nestjs/common";
import { TestingModule } from "@nestjs/testing";
import { PrismaService } from "../../prisma/prisma.service";
import { createTestModule } from "../../../../test/test-module";
import { resetDatabase } from "../../../../test/test-database";
import { seedAdminRoles } from "../../../../test/admin-auth";
import { AdminRoleService } from "./admin-role.service";

// RX-96: role assignment keeps at least one owner (PRD 09 F3, F5), on the test database.
const PARALLEL_ROUNDS = 10;

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

    await roles.assignRole(admin.id, "finance");

    expect(await roleOf(admin.id)).toBe("finance");
  });

  it("demotes one of two owners", async () => {
    const first = await createAdmin("a@example.com", "owner");
    await createAdmin("b@example.com", "owner");

    await roles.assignRole(first.id, "viewer");

    expect(await roleOf(first.id)).toBe("viewer");
    expect(await ownerCount()).toBe(1);
  });

  it("the last owner: 409, role unchanged", async () => {
    const owner = await createAdmin("a@example.com", "owner");
    await createAdmin("ops@example.com", "operations");

    await expect(roles.assignRole(owner.id, "operations")).rejects.toBeInstanceOf(ConflictException);

    expect(await roleOf(owner.id)).toBe("owner");
  });

  it("the last owner keeping owner: allowed (no change)", async () => {
    const owner = await createAdmin("a@example.com", "owner");

    await roles.assignRole(owner.id, "owner");

    expect(await roleOf(owner.id)).toBe("owner");
  });

  it("promoting to owner, then the first owner may step down", async () => {
    const owner = await createAdmin("a@example.com", "owner");
    const ops = await createAdmin("ops@example.com", "operations");
    await roles.assignRole(ops.id, "owner");

    await roles.assignRole(owner.id, "viewer");

    expect([await roleOf(owner.id), await roleOf(ops.id)]).toEqual(["viewer", "owner"]);
  });

  it("an unknown role: 400, role unchanged", async () => {
    const admin = await createAdmin("ops@example.com", "operations");

    await expect(roles.assignRole(admin.id, "superuser")).rejects.toBeInstanceOf(BadRequestException);

    expect(await roleOf(admin.id)).toBe("operations");
  });

  it("an unknown admin: 404", async () => {
    await createAdmin("a@example.com", "owner");

    await expect(roles.assignRole("00000000-0000-4000-8000-000000000000", "viewer")).rejects.toBeInstanceOf(NotFoundException);
  });

  it(`two parallel demotions of the only two owners: one succeeds, one gets 409, one owner left (${PARALLEL_ROUNDS} rounds)`, async () => {
    for (let round = 0; round < PARALLEL_ROUNDS; round++) {
      await prisma.adminUser.deleteMany();
      const first = await createAdmin(`a${round}@example.com`, "owner");
      const second = await createAdmin(`b${round}@example.com`, "owner");

      const results = await Promise.allSettled([roles.assignRole(first.id, "viewer"), roles.assignRole(second.id, "viewer")]);

      const fulfilled = results.filter((result) => result.status === "fulfilled");
      const rejected = results.flatMap((result) => (result.status === "rejected" ? [result.reason] : []));
      expect(fulfilled).toHaveLength(1);
      expect(rejected).toHaveLength(1);
      expect(rejected[0]).toBeInstanceOf(ConflictException);
      expect(await ownerCount()).toBe(1);
    }
  });
});
