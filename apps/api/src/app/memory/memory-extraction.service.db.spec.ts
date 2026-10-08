import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Logger } from "@nestjs/common";
import { TestingModule } from "@nestjs/testing";
import { PrismaService } from "../prisma/prisma.service";
import { ProvidersModule } from "../providers/providers.module";
import { ConfigRegistryModule } from "../config/config-registry.module";
import { ModelRegistryService } from "../config/model-registry.service";
import { MemoryModule } from "./memory.module";
import { MemoryExtractionService } from "./memory-extraction.service";
import { createTestModule } from "../../../test/test-module";
import { resetDatabase } from "../../../test/test-database";
import { createUser } from "../../../test/factories";
import { FakeProviderAdapter, withFakeProvider } from "../../../test/fake-provider";

describe("RX-5: memory extraction through ProviderRouter (test database)", () => {
  const fake = new FakeProviderAdapter();
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let service: MemoryExtractionService;
  let registry: ModelRegistryService;

  beforeAll(async () => {
    ({ moduleRef, prisma } = await createTestModule(
      { imports: [ConfigRegistryModule, ProvidersModule, MemoryModule] },
      (b) => withFakeProvider(b, fake),
    ));
    service = moduleRef.get(MemoryExtractionService);
    registry = moduleRef.get(ModelRegistryService);
  });
  beforeEach(async () => {
    await resetDatabase(prisma);
    fake.requests.length = 0;
  });
  afterEach(() => jest.restoreAllMocks());
  afterAll(() => moduleRef?.close());

  const model = (slug: string, tier: string, price: number) =>
    prisma.aiModel.create({
      data: {
        slug,
        modelName: slug,
        providerId: `vendor/${slug}`,
        inputPrice: price,
        outputPrice: price,
        maxTokens: 8000,
        tier,
      },
    });

  /** A topped-up user with a conversation of two user messages. */
  const seedConversation = async () => {
    const user = await createUser(prisma);
    await prisma.transaction.create({
      data: { userId: user.id, amount: 10, type: "topup", status: "success" },
    });
    const conversation = await prisma.conversation.create({
      data: { userId: user.id, model: "any" },
    });
    await prisma.message.createMany({
      data: [
        { conversationId: conversation.id, role: "user", content: "I build fintech apps in Rust." },
        { conversationId: conversation.id, role: "assistant", content: "Nice." },
        { conversationId: conversation.id, role: "user", content: "Please keep answers short." },
      ],
    });
    return { userId: user.id, conversationId: conversation.id };
  };

  const memories = (userId: string) => prisma.userMemory.findMany({ where: { userId } });

  it("stores the extracted facts, calling the cheapest standard model", async () => {
    await model("premium-cheap", "premium", 0.0000001);
    await model("standard-dear", "standard", 0.000002);
    await model("standard-cheap", "standard", 0.000001);
    await registry.refresh();
    fake.enqueue({
      content: JSON.stringify([
        { type: "interest", content: "Builds fintech apps in Rust", confidence: 0.9 },
        { type: "preference", content: "Prefers short answers", confidence: 0.8 },
      ]),
    });
    const { userId, conversationId } = await seedConversation();

    await service.extract(userId, conversationId);

    expect(fake.requests).toHaveLength(1);
    expect(fake.requests[0].providerId).toBe("vendor/standard-cheap");
    expect(fake.requests[0].model).toBe("standard-cheap");
    const rows = await memories(userId);
    expect(rows.map((r) => r.content).sort()).toEqual([
      "Builds fintech apps in Rust",
      "Prefers short answers",
    ]);
    expect(rows.every((r) => r.sourceConversationId === conversationId)).toBe(true);
  });

  it("logs and resolves when the provider fails, storing nothing", async () => {
    await model("standard-cheap", "standard", 0.000001);
    await registry.refresh();
    fake.enqueue(); // no scripted turn: the fake throws
    const error = jest.spyOn(Logger.prototype, "error").mockImplementation();
    const { userId, conversationId } = await seedConversation();

    await expect(service.extract(userId, conversationId)).resolves.toBeUndefined();

    expect(fake.requests).toHaveLength(1);
    expect(error).toHaveBeenCalledWith(
      expect.stringContaining(`conversation ${conversationId}`),
      expect.anything(),
    );
    expect(await memories(userId)).toHaveLength(0);
  });

  it("logs and resolves without calling the provider when no standard model exists", async () => {
    await model("premium-only", "premium", 0.000001);
    await registry.refresh();
    const warn = jest.spyOn(Logger.prototype, "warn").mockImplementation();
    const { userId, conversationId } = await seedConversation();

    await expect(service.extract(userId, conversationId)).resolves.toBeUndefined();

    expect(fake.requests).toHaveLength(0);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("no active standard-tier model"));
    expect(await memories(userId)).toHaveLength(0);
  });
});

// Independent of the database setup above: the service must never hold the key or a provider URL.
describe("RX-5: memory extraction source", () => {
  it("has no Together URL and does not touch the API key", () => {
    const source = readFileSync(join(__dirname, "memory-extraction.service.ts"), "utf8");
    expect(source).not.toMatch(/together/i);
    expect(source).not.toContain("OPENROUTER_API_KEY");
  });
});
