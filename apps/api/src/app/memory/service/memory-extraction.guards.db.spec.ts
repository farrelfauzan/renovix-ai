import { TestingModule } from "@nestjs/testing";
import { PrismaService } from "../../prisma/prisma.service";
import { ProvidersModule } from "../../providers/providers.module";
import { ConfigRegistryModule } from "../../config/config-registry.module";
import { ModelRegistryService } from "../../config/model-registry.service";
import { MemoryModule } from "../memory.module";
import { MemoryExtractionService } from "./memory-extraction.service";
import { createTestModule } from "../../../../test/test-module";
import { resetDatabase } from "../../../../test/test-database";
import { createUser } from "../../../../test/factories";
import { FakeProviderAdapter, withFakeProvider } from "../../../../test/fake-provider";
import { createResolvableModel } from "../../../../test/provider-model";
import { fundPaidWallet } from "../../../../test/credit-funding";

// RX-141: the conditions of the extraction's queries (eligibility, the 5-conversation window, the
// messages it reads, the duplicate and conflict lookups), written against the code before they moved into
// repositories. The existing suite (memory-extraction.service.db.spec.ts, RX-5) covers the happy path.
// A skipped extraction is seen as "the fake provider was not called". Real services, test database,
// fake provider.
describe("RX-141: memory extraction conditions (test database)", () => {
  const fake = new FakeProviderAdapter();
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let service: MemoryExtractionService;

  beforeAll(async () => {
    ({ moduleRef, prisma } = await createTestModule(
      { imports: [ConfigRegistryModule, ProvidersModule, MemoryModule] },
      (b) => withFakeProvider(b, fake),
    ));
    service = moduleRef.get(MemoryExtractionService);
  });
  beforeEach(async () => {
    await resetDatabase(prisma);
    fake.requests.length = 0;
    await createResolvableModel(prisma, { slug: "standard-cheap", modelName: "standard-cheap", inputPrice: 0.000001, outputPrice: 0.000001, maxTokens: 8000, tier: "standard" });
    await moduleRef.get(ModelRegistryService).refresh();
  });
  afterAll(() => moduleRef?.close());

  /** A user with a paid credit account: funded through the real ledger, which creates the account (RNX-186). */
  const toppedUp = async () => {
    const user = await createUser(prisma);
    await fundPaidWallet(prisma, user.id, 10);
    return user;
  };
  /** A conversation with `userMessages` user messages and `assistantMessages` assistant ones, updated at `updatedAt`. */
  const conversation = async (userId: string, userMessages: number, assistantMessages = 0, updatedAt = new Date(), prefix = "m") => {
    const created = await prisma.conversation.create({ data: { userId, model: "any" } });
    const base = Date.now();
    const rows = [
      ...Array.from({ length: userMessages }, (_, i) => ({ role: "user", content: `${prefix}-user-${i + 1}` })),
      ...Array.from({ length: assistantMessages }, (_, i) => ({ role: "assistant", content: `${prefix}-assistant-${i + 1}` })),
    ];
    await prisma.message.createMany({
      data: rows.map((r, i) => ({ conversationId: created.id, ...r, createdAt: new Date(base + i * 1000) })),
    });
    await prisma.conversation.update({ where: { id: created.id }, data: { updatedAt } });
    return created;
  };
  const daysAgo = (n: number) => new Date(Date.now() - n * 24 * 60 * 60 * 1000);
  const fact = (content: string, confidence = 0.9) => JSON.stringify([{ type: "interest", content, confidence }]);
  const memories = (userId: string) => prisma.userMemory.findMany({ where: { userId }, orderBy: { content: "asc" } });

  // RNX-186: was "a successful top-up of this user" (a Transaction row of type topup, status success). The Transaction
  // table is gone; the ledger creates the paid account with the first paid grant (top-up, code bonus or plan_grant).
  describe("eligibility: this user has a paid credit account", () => {
    it("calls the provider for a user with a paid credit account", async () => {
      fake.enqueue({ content: "[]" });
      const user = await toppedUp();
      const conv = await conversation(user.id, 2);

      await service.extract(user.id, conv.id);

      expect(fake.requests).toHaveLength(1);
    });

    it("skips a user without any credit account", async () => {
      const user = await createUser(prisma);
      const conv = await conversation(user.id, 2);

      await service.extract(user.id, conv.id);

      expect(fake.requests).toHaveLength(0);
    });

    it("skips a user whose only credit account is the weekly free wallet", async () => {
      const user = await createUser(prisma);
      await prisma.creditAccount.create({ data: { userId: user.id, wallet: "weekly_free" } });
      const conv = await conversation(user.id, 2);

      await service.extract(user.id, conv.id);

      expect(fake.requests).toHaveLength(0);
    });

    it("skips a user without a paid account even when another user has one", async () => {
      await toppedUp();
      const user = await createUser(prisma);
      const conv = await conversation(user.id, 2);

      await service.extract(user.id, conv.id);

      expect(fake.requests).toHaveLength(0);
    });

    it("resolves without a call for an unknown user", async () => {

      await expect(service.extract("00000000-0000-0000-0000-000000000000", "none")).resolves.toBeUndefined();

      expect(fake.requests).toHaveLength(0);
    });
  });

  describe("the window: the 5 most recently updated conversations of this user with 2 user messages", () => {
    it("skips a conversation of another user", async () => {
      const alice = await toppedUp();
      const bob = await createUser(prisma);
      await conversation(alice.id, 2);
      const foreign = await conversation(bob.id, 2);

      await service.extract(alice.id, foreign.id);

      expect(fake.requests).toHaveLength(0);
    });

    it("includes the fifth most recent qualifying conversation and skips the sixth", async () => {
      fake.enqueue({ content: "[]" });
      const user = await toppedUp();
      const convs = [];
      for (let i = 0; i < 6; i++) convs.push(await conversation(user.id, 2, 0, daysAgo(i + 1)));

      await service.extract(user.id, convs[5].id);
      expect(fake.requests).toHaveLength(0);
      await service.extract(user.id, convs[4].id);
      expect(fake.requests).toHaveLength(1);
    });

    it("does not count a conversation with fewer than 2 user messages, however many assistant messages it has", async () => {
      fake.enqueue({ content: "[]" });
      const user = await toppedUp();
      for (let i = 0; i < 5; i++) await conversation(user.id, 1, 3, daysAgo(i + 1));
      const target = await conversation(user.id, 2, 0, daysAgo(10));

      await service.extract(user.id, target.id);

      expect(fake.requests).toHaveLength(1);
    });

    it("looks only at the 20 most recently updated conversations", async () => {
      const user = await toppedUp();
      for (let i = 0; i < 20; i++) await conversation(user.id, 0, 0, daysAgo(i + 1));
      const target = await conversation(user.id, 2, 0, daysAgo(30));

      await service.extract(user.id, target.id);

      expect(fake.requests).toHaveLength(0);
    });

    it("skips a conversation with fewer than 2 user messages that is in the window", async () => {
      const user = await toppedUp();
      const conv = await conversation(user.id, 1, 2);

      await service.extract(user.id, conv.id);

      expect(fake.requests).toHaveLength(0);
    });
  });

  it("gives the model the user messages of this conversation only, oldest first", async () => {
    fake.enqueue({ content: "[]" });
    const user = await toppedUp();
    await conversation(user.id, 3, 1, daysAgo(1), "other");
    const target = await conversation(user.id, 3, 2, new Date(), "target");

    await service.extract(user.id, target.id);

    const prompt = fake.requests[0].messages[1].content as string;
    expect(prompt).toContain("target-user-1\n---\ntarget-user-2\n---\ntarget-user-3");
    expect(prompt).not.toContain("other-");
    expect(prompt).not.toContain("assistant");
  });

  describe("storing a fact", () => {
    it("treats a deleted memory with the same text as no duplicate: stores a new active row and leaves the deleted one deleted", async () => {
      fake.enqueue({ content: fact("Builds fintech apps in Rust") });
      const user = await toppedUp();
      const conv = await conversation(user.id, 2);
      const deleted = await prisma.userMemory.create({ data: { userId: user.id, type: "interest", content: "Builds fintech apps in Rust", status: "deleted", confidence: 0.6 } });

      await service.extract(user.id, conv.id);

      const rows = await memories(user.id);
      expect(rows).toHaveLength(2);
      expect(rows.find((r) => r.id === deleted.id)).toMatchObject({ status: "deleted", confidence: 0.6 });
      expect(rows.find((r) => r.id !== deleted.id)).toMatchObject({ status: "active", sourceConversationId: conv.id });
    });

    it("confirms an active duplicate of this user (confidence 0.9) and stores no new row", async () => {
      fake.enqueue({ content: fact("Builds fintech apps in Rust") });
      const user = await toppedUp();
      const conv = await conversation(user.id, 2);
      const existing = await prisma.userMemory.create({ data: { userId: user.id, type: "interest", content: "Builds fintech apps in Rust", confidence: 0.6 } });

      await service.extract(user.id, conv.id);

      const rows = await memories(user.id);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ id: existing.id, confidence: 0.9 });
    });

    it("does not treat another user's memory as a duplicate, and leaves it as it was", async () => {
      fake.enqueue({ content: fact("Builds fintech apps in Rust") });
      const alice = await toppedUp();
      const bob = await createUser(prisma);
      const conv = await conversation(alice.id, 2);
      const foreign = await prisma.userMemory.create({ data: { userId: bob.id, type: "interest", content: "Builds fintech apps in Rust", confidence: 0.6 } });

      await service.extract(alice.id, conv.id);

      expect(await memories(alice.id)).toHaveLength(1);
      expect(await prisma.userMemory.findUniqueOrThrow({ where: { id: foreign.id } })).toMatchObject({ confidence: 0.6, status: "active" });
    });

    it("archives an active memory of this user and type that the new fact overrides, not a deleted or another user's one", async () => {
      fake.enqueue({ content: fact("Uses vue for the frontend") });
      const alice = await toppedUp();
      const bob = await createUser(prisma);
      const conv = await conversation(alice.id, 2);
      const overridden = await prisma.userMemory.create({ data: { userId: alice.id, type: "interest", content: "Uses react for the frontend" } });
      const deleted = await prisma.userMemory.create({ data: { userId: alice.id, type: "interest", content: "Uses angular for the frontend", status: "deleted" } });
      const foreign = await prisma.userMemory.create({ data: { userId: bob.id, type: "interest", content: "Uses react for the frontend" } });

      await service.extract(alice.id, conv.id);

      expect((await prisma.userMemory.findUniqueOrThrow({ where: { id: overridden.id } })).status).toBe("archived");
      expect((await prisma.userMemory.findUniqueOrThrow({ where: { id: deleted.id } })).status).toBe("deleted");
      expect((await prisma.userMemory.findUniqueOrThrow({ where: { id: foreign.id } })).status).toBe("active");
    });
  });
});
