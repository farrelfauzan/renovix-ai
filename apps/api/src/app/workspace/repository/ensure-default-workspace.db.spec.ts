import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { TestingModule } from "@nestjs/testing";
import { PrismaService } from "../../prisma/prisma.service";
import type { DbTransaction } from "../../prisma/db-transaction";
import { createTestModule } from "../../../../test/test-module";
import { resetDatabase, testDatabaseUrl } from "../../../../test/test-database";
import { createAgent, createUser, createWorkspace } from "../../../../test/factories";
import { createResolvableModel } from "../../../../test/provider-model";
import { ensureDefaultWorkspace } from "./ensure-default-workspace";

// RNX-117 (test database — needs TEST_DATABASE_URL): every account has one default workspace.
// `ensureDefaultWorkspace` is the function the Better Auth `databaseHooks.user.create.after` hook calls
// (social and email sign-up, apps/api/src/lib/auth.ts, called there as `ensureDefaultWorkspace(client, user.id)`);
// lib/auth is mocked in every spec (better-auth is ESM-only), so it is tested here directly. The schema guards
// of the migration 20261020160000_default_workspaces and the seed-agents run are here too.

const REPO_ROOT = resolve(__dirname, "../../../../../..");
const SYSTEM_USER_EMAIL = "system@renovix.ai";

describe("RNX-117: default workspace (test database)", () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;

  beforeAll(async () => {
    ({ moduleRef, prisma } = await createTestModule({}));
  });
  beforeEach(() => resetDatabase(prisma));
  afterAll(() => moduleRef?.close());

  const defaultsOf = (ownerId: string) =>
    prisma.workspace.findMany({ where: { ownerId, isDefault: true }, include: { members: true } });

  /** A client whose `workspace.findFirst` holds every caller until `callers` have read, so all see "none yet". */
  const holdCallersAtFirstRead = (callers: number): DbTransaction => {
    let arrived = 0;
    let releaseAll!: () => void;
    const allArrived = new Promise<void>((done) => (releaseAll = done));
    const workspace = {
      findFirst: async (args: Parameters<typeof prisma.workspace.findFirst>[0]) => {
        const row = await prisma.workspace.findFirst(args);
        arrived += 1;
        if (arrived === callers) releaseAll();
        await allArrived;
        return row;
      },
      create: (args: Parameters<typeof prisma.workspace.create>[0]) => prisma.workspace.create(args),
      findFirstOrThrow: (args: Parameters<typeof prisma.workspace.findFirstOrThrow>[0]) =>
        prisma.workspace.findFirstOrThrow(args),
    };
    return { workspace } as unknown as DbTransaction;
  };

  describe("ensureDefaultWorkspace (the sign-up hook's function)", () => {
    it("gives a new account exactly one default workspace it owns, with an active owner member row", async () => {
      const user = await createUser(prisma);

      const workspace = await ensureDefaultWorkspace(prisma, user.id);

      const defaults = await defaultsOf(user.id);
      expect(defaults).toHaveLength(1);
      expect(defaults[0]).toMatchObject({ id: workspace.id, ownerId: user.id, isDefault: true, status: "active", channelId: null });
      expect(defaults[0].members).toEqual([
        expect.objectContaining({ userId: user.id, role: "owner", status: "active", joinedAt: expect.any(Date) }),
      ]);
    });

    it("is idempotent: a second call returns the same workspace and creates nothing", async () => {
      const user = await createUser(prisma);

      const first = await ensureDefaultWorkspace(prisma, user.id);
      const second = await ensureDefaultWorkspace(prisma, user.id);

      expect(second.id).toBe(first.id);
      expect(await prisma.workspace.count()).toBe(1);
      expect(await prisma.workspaceMember.count()).toBe(1);
    });

    it("ignores the account's other workspaces: creates the default one beside them", async () => {
      const user = await createUser(prisma);
      const other = await createWorkspace(prisma, { ownerId: user.id });

      const workspace = await ensureDefaultWorkspace(prisma, user.id);

      expect(workspace.id).not.toBe(other.id);
      expect(await defaultsOf(user.id)).toHaveLength(1);
    });

    it("two callers at the same moment get one default workspace (the loser reads the winner's), never an error", async () => {
      const user = await createUser(prisma);
      const held = holdCallersAtFirstRead(2);

      const [a, b] = await Promise.all([ensureDefaultWorkspace(held, user.id), ensureDefaultWorkspace(held, user.id)]);

      expect(a.id).toBe(b.id);
      expect(await defaultsOf(user.id)).toHaveLength(1);
      expect(await prisma.workspaceMember.count()).toBe(1);
    });
  });

  describe("schema (migration 20261020160000_default_workspaces)", () => {
    it("refuses a second default workspace for the same owner; other owners and non-default ones are fine", async () => {
      const alice = await createUser(prisma);
      const bob = await createUser(prisma);
      await createWorkspace(prisma, { ownerId: alice.id, isDefault: true });

      await expect(createWorkspace(prisma, { ownerId: alice.id, isDefault: true })).rejects.toMatchObject({ code: "P2002" });
      await createWorkspace(prisma, { ownerId: alice.id });
      await createWorkspace(prisma, { ownerId: bob.id, isDefault: true });
      expect(await prisma.workspace.count({ where: { isDefault: true } })).toBe(2);
    });

    it("refuses an agent without a workspace", async () => {
      const user = await createUser(prisma);

      await expect(
        prisma.$executeRaw`INSERT INTO agents (id, "userId", name, slug, system_prompt, model, "updatedAt") VALUES (gen_random_uuid(), ${user.id}, 'a', 'a', 'p', 'm', now())`,
      ).rejects.toThrow(/workspace_id/);
      expect(await prisma.agent.count()).toBe(0);
    });

    it("refuses to delete a workspace that still has an agent (onDelete Restrict)", async () => {
      const user = await createUser(prisma);
      const agent = await createAgent(prisma, { userId: user.id });

      await expect(prisma.workspace.delete({ where: { id: agent.workspaceId } })).rejects.toMatchObject({ code: "P2003" });
      expect(await prisma.agent.findUnique({ where: { id: agent.id } })).not.toBeNull();
    });
  });

  describe("prisma/seed-agents.ts", () => {
    const runSeed = () =>
      execFileSync("bun", ["prisma/seed-agents.ts"], {
        cwd: REPO_ROOT,
        env: { ...process.env, DATABASE_URL: testDatabaseUrl() },
        stdio: "pipe",
      });

    it("run twice: the system user has exactly one default workspace, and every seeded agent is in it", async () => {
      await createResolvableModel(prisma);

      runSeed();
      runSeed();

      const system = await prisma.user.findUniqueOrThrow({ where: { email: SYSTEM_USER_EMAIL } });
      const defaults = await defaultsOf(system.id);
      expect(defaults).toHaveLength(1);
      expect(await prisma.workspace.count({ where: { ownerId: system.id } })).toBe(1);
      const agents = await prisma.agent.findMany({ where: { userId: system.id } });
      expect(agents.length).toBeGreaterThan(0);
      expect(new Set(agents.map((a) => a.workspaceId))).toEqual(new Set([defaults[0].id]));
    }, 60_000);
  });
});
