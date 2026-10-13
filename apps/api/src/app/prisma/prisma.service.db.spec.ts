import { TestingModule } from "@nestjs/testing";
import { PrismaService } from "./prisma.service";
import { createTestModule } from "../../../test/test-module";
import { resetDatabase } from "../../../test/test-database";
import { createAgent, createUser } from "../../../test/factories";

// The default filter ships with an empty map, so the tests that need a model on it build a second
// client through the same factory, with Reminder (the one model that has `deletedAt` today).
describe("PrismaService (test database)", () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService; // as injected: PrismaService.create(), empty map
  let filtering: PrismaService; // PrismaService.create() with Reminder on the map
  let rows: Awaited<ReturnType<typeof seed>>;

  async function seed() {
    const user = await createUser(prisma);
    const agent = await createAgent(prisma, { userId: user.id });
    const channel = await prisma.channel.create({ data: { userId: user.id, name: "c" } });
    const room = await prisma.channelChatRoom.create({ data: { channelId: channel.id } });
    const data = {
      userId: user.id,
      agentId: agent.id,
      channelId: channel.id,
      chatRoomId: room.id,
      prompt: "p",
      cronExpression: "0 8 * * *",
      nextRunAt: new Date(),
    };
    const visible = await prisma.reminder.create({ data: { ...data, description: "visible" } });
    const deleted = await prisma.reminder.create({
      data: { ...data, description: "deleted", deletedAt: new Date() },
    });
    return { data, visible, deleted };
  }

  /** The same three top-level reads outside a transaction, in the callback form and in the array form. */
  async function readEverywhere(client: PrismaService, where: { deletedAt?: { not: null } } = {}) {
    const read = async (db: Pick<PrismaService, "reminder">) => ({
      ids: (await db.reminder.findMany({ where, orderBy: { description: "asc" } })).map((r) => r.id),
      count: await db.reminder.count({ where }),
      deletedById: (await db.reminder.findUnique({ where: { ...where, id: rows.deleted.id } }))?.id ?? null,
    });
    const [found, count, deletedById] = await client.$transaction([
      client.reminder.findMany({ where, orderBy: { description: "asc" } }),
      client.reminder.count({ where }),
      client.reminder.findUnique({ where: { ...where, id: rows.deleted.id } }),
    ]);
    return {
      outside: await read(client),
      callbackForm: await client.$transaction((tx) => read(tx)),
      arrayForm: { ids: found.map((r) => r.id), count, deletedById: deletedById?.id ?? null },
    };
  }

  const descriptionOf = async (id: string) =>
    (await prisma.reminder.findUniqueOrThrow({ where: { id } })).description;

  beforeAll(async () => {
    ({ moduleRef, prisma } = await createTestModule({}));
    filtering = PrismaService.create({ Reminder: { deletedAt: null } });
  });

  beforeEach(async () => {
    await resetDatabase(prisma);
    rows = await seed();
  });

  afterEach(() => jest.restoreAllMocks());

  afterAll(async () => {
    await filtering?.$disconnect();
    await moduleRef?.close();
  });

  it("with a model on the map, a top-level read hides the deleted row outside a transaction, in the callback form and in the array form alike", async () => {
    const hidden = { ids: [rows.visible.id], count: 1, deletedById: null };

    const actual = await readEverywhere(filtering);

    expect(actual.outside).toEqual(hidden);
    expect(actual.callbackForm).toEqual(hidden);
    expect(actual.arrayForm).toEqual(hidden);
  });

  it("a condition the caller writes on the column wins, in all three places", async () => {
    const onlyDeleted = { ids: [rows.deleted.id], count: 1, deletedById: rows.deleted.id };

    const actual = await readEverywhere(filtering, { deletedAt: { not: null } });

    expect(actual.outside).toEqual(onlyDeleted);
    expect(actual.callbackForm).toEqual(onlyDeleted);
    expect(actual.arrayForm).toEqual(onlyDeleted);
  });

  it("with the empty map (as shipped), the same reads return the deleted row", async () => {
    const all = { ids: [rows.deleted.id, rows.visible.id], count: 2, deletedById: rows.deleted.id };

    const actual = await readEverywhere(prisma);

    expect(actual.outside).toEqual(all);
    expect(actual.callbackForm).toEqual(all);
    expect(actual.arrayForm).toEqual(all);
  });

  it.each([
    ["with a model on the map", () => filtering],
    ["with the empty map", () => prisma],
  ])("the callback form is still one transaction %s: a throw rolls the write back", async (_case, client) => {
    const run = client().$transaction(async (tx) => {
      await tx.reminder.update({ where: { id: rows.visible.id }, data: { description: "changed" } });
      throw new Error("abort");
    });

    await expect(run).rejects.toThrow("abort");
    expect(await descriptionOf(rows.visible.id)).toBe("visible");
  });

  it.each([
    ["with a model on the map", () => filtering],
    ["with the empty map", () => prisma],
  ])("the array form is still one transaction %s: a failing second statement rolls the first write back", async (_case, client) => {
    const db = client();
    const run = db.$transaction([
      db.reminder.update({ where: { id: rows.visible.id }, data: { description: "changed" } }),
      db.reminder.create({ data: { ...rows.data, id: rows.visible.id } }), // duplicate id
    ]);

    await expect(run).rejects.toMatchObject({ code: "P2002" });
    expect(await descriptionOf(rows.visible.id)).toBe("visible");
  });

  it("a module gets the client PrismaService.create() built, connects it on init and disconnects it on close", async () => {
    const create = jest.spyOn(PrismaService, "create");
    const init = jest.spyOn(PrismaService.prototype, "onModuleInit");
    const destroy = jest.spyOn(PrismaService.prototype, "onModuleDestroy");
    const otherConnections = async () => {
      const [{ n }] = await prisma.$queryRaw<{ n: number }[]>`
        SELECT count(*)::int AS n FROM pg_stat_activity
        WHERE datname = current_database() AND pid <> pg_backend_pid()`;
      return n;
    };

    const other = await createTestModule({});
    await other.moduleRef.init();
    await other.prisma.reminder.count();
    const openBeforeClose = await otherConnections();
    await other.moduleRef.close();
    const closedByModule = openBeforeClose - (await otherConnections());

    expect(create.mock.calls).toEqual([[]]); // no map passed: the shipped one
    expect(other.prisma).toBe(create.mock.results[0].value);
    expect([init.mock.calls.length, destroy.mock.calls.length]).toEqual([1, 1]);
    expect(closedByModule).toBeGreaterThan(0);
  });
});
