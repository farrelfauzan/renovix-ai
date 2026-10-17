import { TestingModule } from "@nestjs/testing";
import { PrismaService } from "../../prisma/prisma.service";
import { UserMemoryService } from "./user-memory.service";
import { createTestModule } from "../../../../test/test-module";
import { resetDatabase } from "../../../../test/test-database";
import { createUser } from "../../../../test/factories";

// RX-141: the conditions of every user memory query, written against the code before the queries moved
// into UserMemoryRepository. The memory module has no HTTP route, so the service is the surface (the chat
// prompt reads getRelevantMemories, the extraction reads findDuplicate, confirmMemory, archiveConflicting
// and create). Each test leaves exactly one condition of a query to decide the result: the other user's
// row differs only in the user, the deleted row only in the status, and so on. Real service, test database.
describe("RX-141: user memory queries (test database)", () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let service: UserMemoryService;

  beforeAll(async () => {
    ({ moduleRef, prisma } = await createTestModule({ providers: [UserMemoryService] }));
    service = moduleRef.get(UserMemoryService);
  });
  beforeEach(() => resetDatabase(prisma));
  afterAll(() => moduleRef?.close());

  const memory = (
    userId: string,
    content: string,
    data: { type?: string; status?: string; confidence?: number; isUserPinned?: boolean; lastConfirmedAt?: Date; expiresAt?: Date | null } = {},
  ) => prisma.userMemory.create({ data: { userId, type: "interest", content, ...data } });
  const row = (id: string) => prisma.userMemory.findUniqueOrThrow({ where: { id } });
  const contents = (items: { content: string }[]) => items.map((m) => m.content);

  it("listActive: only this user's active rows, pinned first then most recently confirmed", async () => {
    const alice = await createUser(prisma);
    const bob = await createUser(prisma);
    await memory(alice.id, "old", { lastConfirmedAt: new Date("2026-01-01") });
    await memory(alice.id, "new", { lastConfirmedAt: new Date("2026-02-01") });
    await memory(alice.id, "pinned", { isUserPinned: true, lastConfirmedAt: new Date("2025-01-01") });
    await memory(alice.id, "archived", { status: "archived" });
    await memory(alice.id, "deleted", { status: "deleted" });
    await memory(bob.id, "bob");

    expect(contents(await service.listActive(alice.id))).toEqual(["pinned", "new", "old"]);
  });

  it("listAll: this user's rows that are not deleted (archived stay), the deleted and other users' rows stay out", async () => {
    const alice = await createUser(prisma);
    const bob = await createUser(prisma);
    await memory(alice.id, "active");
    await memory(alice.id, "archived", { status: "archived" });
    await memory(alice.id, "deleted", { status: "deleted" });
    await memory(bob.id, "bob");

    expect(contents(await service.listAll(alice.id)).sort()).toEqual(["active", "archived"]);
  });

  it("getById: returns the row of this user; null for the id of another user, for a deleted row and for another id", async () => {
    const alice = await createUser(prisma);
    const bob = await createUser(prisma);
    const own = await memory(alice.id, "own");
    const second = await memory(alice.id, "second");
    const foreign = await memory(bob.id, "foreign");
    const deleted = await memory(alice.id, "deleted", { status: "deleted" });
    const archived = await memory(alice.id, "archived", { status: "archived" });

    expect((await service.getById(alice.id, own.id))?.content).toBe("own");
    expect((await service.getById(alice.id, second.id))?.content).toBe("second");
    expect((await service.getById(alice.id, archived.id))?.content).toBe("archived");
    expect(await service.getById(alice.id, foreign.id)).toBeNull();
    expect(await service.getById(alice.id, deleted.id)).toBeNull();
    expect(await service.getById(alice.id, "00000000-0000-0000-0000-000000000000")).toBeNull();
  });

  it("create: stores the row with the defaults for the optional fields", async () => {
    const alice = await createUser(prisma);

    const created = await service.create(alice.id, { type: "preference", content: "short answers" });

    expect(created).toMatchObject({
      userId: alice.id,
      type: "preference",
      content: "short answers",
      confidence: 0.75,
      sourceMessageId: null,
      sourceConversationId: null,
      status: "active",
    });
    const kept = await service.create(alice.id, {
      type: "context",
      content: "x",
      confidence: 0.9,
      sourceMessageId: "m1",
      sourceConversationId: "c1",
    });
    expect(kept).toMatchObject({ confidence: 0.9, sourceMessageId: "m1", sourceConversationId: "c1" });
  });

  it("update: changes the content and the pin of this user's row and moves lastConfirmedAt", async () => {
    const alice = await createUser(prisma);
    const own = await memory(alice.id, "own", { lastConfirmedAt: new Date("2020-01-01") });

    const updated = await service.update(alice.id, own.id, { content: "changed", isUserPinned: true });

    expect(updated).toMatchObject({ content: "changed", isUserPinned: true });
    expect(updated!.lastConfirmedAt.getTime()).toBeGreaterThan(new Date("2021-01-01").getTime());
    const onlyPin = await service.update(alice.id, own.id, { isUserPinned: false });
    expect(onlyPin).toMatchObject({ content: "changed", isUserPinned: false });
  });

  it("update: null and nothing written for another user's row, for a deleted row, and the other row of the same user stays as it was", async () => {
    const alice = await createUser(prisma);
    const bob = await createUser(prisma);
    const foreign = await memory(bob.id, "foreign");
    const deleted = await memory(alice.id, "deleted", { status: "deleted" });
    const other = await memory(alice.id, "other");
    const target = await memory(alice.id, "target");

    expect(await service.update(alice.id, foreign.id, { content: "hacked" })).toBeNull();
    expect(await service.update(alice.id, deleted.id, { content: "hacked" })).toBeNull();
    await service.update(alice.id, target.id, { content: "edited" });

    expect((await row(foreign.id)).content).toBe("foreign");
    expect((await row(deleted.id)).content).toBe("deleted");
    expect((await row(other.id)).content).toBe("other");
    expect((await row(target.id)).content).toBe("edited");
  });

  it("delete: marks this user's row deleted, true; the other row of the same user stays active", async () => {
    const alice = await createUser(prisma);
    const target = await memory(alice.id, "target");
    const other = await memory(alice.id, "other");

    expect(await service.delete(alice.id, target.id)).toBe(true);

    expect((await row(target.id)).status).toBe("deleted");
    expect((await row(other.id)).status).toBe("active");
  });

  it("delete: false and nothing written for another user's row and for a row already deleted", async () => {
    const alice = await createUser(prisma);
    const bob = await createUser(prisma);
    const foreign = await memory(bob.id, "foreign");
    const deleted = await memory(alice.id, "deleted", { status: "deleted" });
    const before = await row(deleted.id);

    expect(await service.delete(alice.id, foreign.id)).toBe(false);
    expect(await service.delete(alice.id, deleted.id)).toBe(false);

    expect((await row(foreign.id)).status).toBe("active");
    expect((await row(deleted.id)).updatedAt).toEqual(before.updatedAt);
  });

  it("clearAll: marks every non-deleted row of this user deleted and counts them; other users' rows stay, deleted rows are not counted", async () => {
    const alice = await createUser(prisma);
    const bob = await createUser(prisma);
    const a = await memory(alice.id, "a");
    const b = await memory(alice.id, "b", { status: "archived" });
    await memory(alice.id, "c", { status: "deleted" });
    const foreign = await memory(bob.id, "foreign");

    expect(await service.clearAll(alice.id)).toBe(2);

    expect((await row(a.id)).status).toBe("deleted");
    expect((await row(b.id)).status).toBe("deleted");
    expect((await row(foreign.id)).status).toBe("active");
  });

  describe("getRelevantMemories", () => {
    it("returns this user's active rows with confidence from 0.55 that have not expired; pinned first, then confidence, then confirmation", async () => {
      const alice = await createUser(prisma);
      const bob = await createUser(prisma);
      const day = 24 * 60 * 60 * 1000;
      await memory(alice.id, "low-boundary", { confidence: 0.55 });
      await memory(alice.id, "too-low", { confidence: 0.54 });
      await memory(alice.id, "high", { confidence: 0.95 });
      await memory(alice.id, "pinned-low", { confidence: 0.6, isUserPinned: true });
      await memory(alice.id, "future", { confidence: 0.7, expiresAt: new Date(Date.now() + day) });
      await memory(alice.id, "expired", { confidence: 0.99, expiresAt: new Date(Date.now() - day) });
      await memory(alice.id, "archived", { confidence: 0.99, status: "archived" });
      await memory(alice.id, "deleted", { confidence: 0.99, status: "deleted" });
      await memory(bob.id, "bob", { confidence: 0.99 });

      const result = await service.getRelevantMemories(alice.id);

      expect(contents(result)).toEqual(["pinned-low", "high", "future", "low-boundary"]);
    });

    it("breaks a tie of pin and confidence by the latest confirmation, and returns at most maxItems", async () => {
      const alice = await createUser(prisma);
      await memory(alice.id, "older", { confidence: 0.8, lastConfirmedAt: new Date("2026-01-01") });
      await memory(alice.id, "newer", { confidence: 0.8, lastConfirmedAt: new Date("2026-02-01") });
      await memory(alice.id, "third", { confidence: 0.7 });

      expect(contents(await service.getRelevantMemories(alice.id, 2))).toEqual(["newer", "older"]);
      expect(await service.getRelevantMemories(alice.id, 0)).toHaveLength(0);
    });
  });

  it("confirmMemory: sets the confidence to 0.9 and moves lastConfirmedAt of this user's row only", async () => {
    const alice = await createUser(prisma);
    const bob = await createUser(prisma);
    const target = await memory(alice.id, "target", { confidence: 0.6, lastConfirmedAt: new Date("2020-01-01") });
    const other = await memory(alice.id, "other", { confidence: 0.6, lastConfirmedAt: new Date("2020-01-01") });
    const foreign = await memory(bob.id, "foreign", { confidence: 0.6, lastConfirmedAt: new Date("2020-01-01") });

    await service.confirmMemory(alice.id, target.id);
    await service.confirmMemory(alice.id, foreign.id);

    expect(await row(target.id)).toMatchObject({ confidence: 0.9 });
    expect((await row(target.id)).lastConfirmedAt.getFullYear()).toBeGreaterThan(2020);
    expect(await row(other.id)).toMatchObject({ confidence: 0.6, lastConfirmedAt: new Date("2020-01-01") });
    expect(await row(foreign.id)).toMatchObject({ confidence: 0.6, lastConfirmedAt: new Date("2020-01-01") });
  });

  it("archiveConflicting: archives this user's active rows of this type that overlap the new content; nothing else", async () => {
    const alice = await createUser(prisma);
    const bob = await createUser(prisma);
    const hit = await memory(alice.id, "uses react for the frontend");
    const noOverlap = await memory(alice.id, "likes hiking on weekends");
    const otherType = await memory(alice.id, "uses react for the frontend", { type: "context" });
    const archivedAlready = await memory(alice.id, "uses react for the frontend", { status: "archived" });
    const deleted = await memory(alice.id, "uses react for the frontend", { status: "deleted" });
    const foreign = await memory(bob.id, "uses react for the frontend");

    await service.archiveConflicting(alice.id, "uses vue for the frontend", "interest");

    expect((await row(hit.id)).status).toBe("archived");
    expect((await row(noOverlap.id)).status).toBe("active");
    expect((await row(otherType.id)).status).toBe("active");
    expect((await row(deleted.id)).status).toBe("deleted");
    expect((await row(foreign.id)).status).toBe("active");
    expect((await row(archivedAlready.id)).status).toBe("archived");
  });

  describe("findDuplicate", () => {
    it("finds an active row of this user and type whose text equals or contains, or is contained in, the new text (case and edges ignored)", async () => {
      const alice = await createUser(prisma);
      await memory(alice.id, "Builds fintech apps");

      expect((await service.findDuplicate(alice.id, "  builds FINTECH apps ", "interest"))?.content).toBe("Builds fintech apps");
      expect((await service.findDuplicate(alice.id, "builds fintech apps in rust", "interest"))?.content).toBe("Builds fintech apps");
      expect((await service.findDuplicate(alice.id, "fintech", "interest"))?.content).toBe("Builds fintech apps");
      expect(await service.findDuplicate(alice.id, "likes hiking", "interest")).toBeNull();
    });

    it("ignores another user's row, a row of another type, an archived row and a deleted row", async () => {
      const alice = await createUser(prisma);
      const bob = await createUser(prisma);
      await memory(bob.id, "builds fintech apps");
      await memory(alice.id, "builds fintech apps", { type: "context" });
      await memory(alice.id, "builds fintech apps", { status: "archived" });
      await memory(alice.id, "builds fintech apps", { status: "deleted" });

      expect(await service.findDuplicate(alice.id, "builds fintech apps", "interest")).toBeNull();
    });
  });
});
