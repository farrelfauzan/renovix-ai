import { ConfigModule } from "@nestjs/config";
import { TestingModule } from "@nestjs/testing";
import { NestFastifyApplication } from "@nestjs/platform-fastify";
import { randomUUID } from "node:crypto";
import { ChatController } from "./chat.controller";
import { ChatService } from "../service/chat.service";
import { ConversationService } from "../service/conversation.service";
import { CreditService } from "../../billing/service/credit.service";
import { CreditReservationRepository } from "../../billing/repository/credit-reservation.repository";
import { UsageService } from "../../usage/service/usage.service";
import { DocumentService } from "../../document/service/document.service";
import { EmbeddingService } from "../../knowledge/service/embedding.service";
import { SystemKnowledgeService } from "../../knowledge/service/system-knowledge.service";
import { ModelRegistryService } from "../../config/model-registry.service";
import { ProvidersModule } from "../../providers/providers.module";
import { PrismaService } from "../../prisma/prisma.service";
import { createFastifyApp, createTestModule } from "../../../../test/test-module";
import { resetDatabase } from "../../../../test/test-database";
import { createUser, createApiKey, testApiKey } from "../../../../test/factories";
import { fundPaidWallet } from "../../../../test/credit-funding";
import { FakeProviderAdapter, withFakeProvider } from "../../../../test/fake-provider";
import { realPromptTuning } from "../../../../test/real-prompt-tuning";
import { createResolvableModel } from "../../../../test/provider-model";
import { blockOutbound, OutboundBlocker } from "../../../../test/llm-stub";

// RNX-232 (18b, D47): the per-key limits on POST /chat/completions: the key's allowed tiers (403), its monthly credit
// cap in the Asia/Jakarta calendar month (402 CREDITS_EXHAUSTED, atomic on the locked key row), the key on every
// reservation and ledger entry of its calls, and the credits used (X-Credits-Used, `credits_used` on the last chunk).
// Real ChatController, ChatService, CreditService, registry and prompt tuning on the test database (as
// chat.stream.spec.ts); the model is the fake provider (RX-8) and every other outbound call is blocked.
jest.mock("../service/conversation.service", () => ({ ConversationService: class {} }));
jest.mock("../../document/service/document.service", () => ({ DocumentService: class {} }));
jest.mock("../../usage/service/usage.service", () => ({ UsageService: class {} }));

const API_KEY = testApiKey("rnx232-key-limits");
const STANDARD_MODEL = "rnx232-standard";
const PREMIUM_MODEL = "rnx232-premium";
const MESSAGES = [{ role: "user", content: "Hi" }];
/** 30 prompt and 3 output tokens at 1 credit per million tokens: what one fake call below charges. */
const CALL_USAGE = { prompt_tokens: 30, completion_tokens: 3 };
const CALL_CREDITS = "0.000033";
/** How long each cap check of the concurrency test pauses inside its transaction. */
const CHECK_PAUSE_MS = 200;
/** The first seq of the entries written straight to the ledger. */
const PAST_SEQ = 1000;
/** Fakes only Date, set to `now` (Prisma, pg and Fastify keep their real timers). */
const fakeDateOnly = (now: Date) =>
  jest.useFakeTimers({
    now,
    doNotFake: ["hrtime", "nextTick", "performance", "queueMicrotask", "requestAnimationFrame", "cancelAnimationFrame", "requestIdleCallback", "cancelIdleCallback", "setImmediate", "clearImmediate", "setInterval", "clearInterval", "setTimeout", "clearTimeout"],
  });

describe("RNX-232: per-key tiers, monthly cap, ledger attribution and credits used on the API-key chat route (Fastify, test database, fake provider)", () => {
  const fake = new FakeProviderAdapter();
  const tuning = realPromptTuning();
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let app: NestFastifyApplication;
  let blocker: OutboundBlocker;

  beforeAll(async () => {
    ({ moduleRef, prisma } = await createTestModule(
      {
        imports: [ConfigModule.forRoot({ isGlobal: true, ignoreEnvFile: true }), ProvidersModule],
        controllers: [ChatController],
        providers: [
          ChatService,
          CreditService,
          ModelRegistryService,
          ...tuning.providers,
          { provide: ConversationService, useValue: {} },
          { provide: DocumentService, useValue: {} },
          { provide: UsageService, useValue: {} },
        ],
      },
      (b) => withFakeProvider(b, fake),
    ));
    jest.spyOn(moduleRef.get(SystemKnowledgeService), "onApplicationBootstrap").mockResolvedValue(undefined);
    app = await createFastifyApp(moduleRef);
  });

  beforeEach(async () => {
    blocker = blockOutbound();
    await resetDatabase(prisma);
    fake.requests.length = 0;
    for (const tier of ["standard", "premium"]) {
      await prisma.tierRate.create({ data: { tier, inputCreditsPerToken: 1, cachedCreditsPerToken: 1, outputCreditsPerToken: 1 } });
    }
    await createResolvableModel(prisma, { slug: STANDARD_MODEL, modelName: STANDARD_MODEL, tier: "standard", maxTokens: 8192 });
    await createResolvableModel(prisma, { slug: PREMIUM_MODEL, modelName: PREMIUM_MODEL, tier: "premium", maxTokens: 8192 });
    await moduleRef.get(ModelRegistryService).refresh();
    jest
      .spyOn(moduleRef.get(EmbeddingService), "embedSingle")
      .mockResolvedValue({ embedding: Array.from({ length: 1024 }, () => 0), tokenCount: 1 });
    Object.assign(moduleRef.get(UsageService), { logUsage: jest.fn(async () => undefined) });
  });

  afterEach(() => {
    jest.useRealTimers();
    blocker.restore();
    jest.restoreAllMocks();
  });

  afterAll(async () => {
    await app?.close();
    tuning.restoreEnv();
  });

  /** A user with 1 credit on the paid wallet and the route's key (all tiers, no cap unless given); returns the key row. */
  const createKeyUser = async (key: { allowedTiers?: string[]; monthlyCreditCap?: string } = {}) => {
    const user = await createUser(prisma);
    await fundPaidWallet(prisma, user.id, 1);
    await createApiKey(prisma, user.id, { apiKey: API_KEY, ...key });
    return prisma.apiKey.findFirstOrThrow({ where: { userId: user.id } });
  };

  const complete = (payload: Record<string, unknown> = {}) =>
    app.inject({
      method: "POST",
      url: "/chat/completions",
      headers: { authorization: `Bearer ${API_KEY}` },
      payload: { model: STANDARD_MODEL, messages: MESSAGES, ...payload },
    });

  /** A usage entry of this key at `createdAt` charging `credits`, written straight to the ledger (the past, for the month tests). */
  const pastUsage = async (key: { id: string; userId: string }, credits: string, createdAt: Date) => {
    const account = await prisma.creditAccount.findFirstOrThrow({ where: { userId: key.userId } });
    await prisma.creditLedgerEntry.create({
      data: {
        accountId: account.id,
        wallet: "paid",
        seq: PAST_SEQ + (await prisma.creditLedgerEntry.count()), // far above the seqs the calls of a test take
        type: "usage",
        amount: `-${credits}`,
        balanceAfter: account.balance,
        memberUserId: key.userId,
        ...{ requestId: randomUUID(), callId: randomUUID(), modelId: STANDARD_MODEL, tier: "standard", outcome: "completed" as const },
        ...{ rateNew: 1, rateCached: 1, rateOut: 1, tokensNew: 0, tokensCached: 0, tokensOut: 0 },
        idempotencyKey: `rnx232-past:${randomUUID()}`,
        apiKeyId: key.id,
        createdAt,
      },
    });
  };

  /** The data of every SSE event of a body, in order. */
  const sseData = (body: string) =>
    body
      .split("\n\n")
      .filter(Boolean)
      .map((event) => event.replace(/^data: /, ""));

  describe("AC1: a key limited to Standard", () => {
    it("negative: a Premium model is a 403, nothing reserved, no provider call", async () => {
      await createKeyUser({ allowedTiers: ["standard"] });

      const actual = await complete({ model: PREMIUM_MODEL });

      expect(actual.statusCode).toBe(403);
      expect(actual.json().message).toBe("This API key may not use premium models");
      expect(fake.requests).toHaveLength(0);
      expect(await prisma.creditReservation.count()).toBe(0);
    });

    it("control: a Standard model is a 200", async () => {
      await createKeyUser({ allowedTiers: ["standard"] });
      fake.enqueue({ content: "Hello", usage: CALL_USAGE });

      const actual = await complete();

      expect(actual.statusCode).toBe(200);
    });
  });

  describe("AC3: the key's monthly cap", () => {
    it("negative: the month's usage at the cap → 402 CREDITS_EXHAUSTED, nothing reserved, no provider call", async () => {
      await createKeyUser({ monthlyCreditCap: CALL_CREDITS });
      fake.enqueue({ content: "Hello", usage: CALL_USAGE });
      expect((await complete()).statusCode).toBe(200);

      const actual = await complete();

      expect(actual.statusCode).toBe(402);
      expect(actual.json()).toMatchObject({ code: "CREDITS_EXHAUSTED" });
      expect(fake.requests).toHaveLength(1);
      expect(await prisma.creditReservation.count()).toBe(1);
    });

    it("negative: the month's usage plus an open hold of the key at the cap → 402 CREDITS_EXHAUSTED", async () => {
      const key = await createKeyUser({ monthlyCreditCap: "0.5" });
      await pastUsage(key, "0.2", new Date());
      const account = await prisma.creditAccount.findFirstOrThrow({ where: { userId: key.userId } });
      await prisma.creditReservation.create({
        data: { accountId: account.id, wallet: "paid", requestId: randomUUID(), apiKeyId: key.id, amountHeld: "0.4", consumed: "0.1", expiresAt: new Date(Date.now() + 60_000) },
      });

      const actual = await complete();

      expect(actual.statusCode).toBe(402);
      expect(actual.json()).toMatchObject({ code: "CREDITS_EXHAUSTED" });
      expect(fake.requests).toHaveLength(0);
    });

    it("control: under the cap (usage and holds of other keys and closed holds do not count) → 200", async () => {
      const key = await createKeyUser({ monthlyCreditCap: "0.5" });
      await pastUsage(key, "0.2", new Date());
      const account = await prisma.creditAccount.findFirstOrThrow({ where: { userId: key.userId } });
      const hold = { accountId: account.id, wallet: "paid" as const, amountHeld: "0.4", expiresAt: new Date(Date.now() + 60_000) };
      await prisma.creditReservation.create({ data: { ...hold, requestId: randomUUID(), apiKeyId: key.id, status: "settled" } });
      await prisma.creditReservation.create({ data: { ...hold, requestId: randomUUID() } });
      fake.enqueue({ content: "Hello", usage: CALL_USAGE });

      const actual = await complete();

      expect(actual.statusCode).toBe(200);
    });

    it("concurrency: two concurrent calls just under the cap → one answered, one refused; at most one call's overrun recorded", async () => {
      const key = await createKeyUser({ monthlyCreditCap: "0.000034" });
      fake.enqueue({ content: "Hello", usage: CALL_USAGE });
      expect((await complete()).statusCode).toBe(200);
      fake.enqueue({ content: "Hello", usage: CALL_USAGE }, { content: "Hello", usage: CALL_USAGE });
      // Each cap check waits a moment after counting the key's open holds, so the two checks overlap unless the key row
      // lock makes the second wait for the first's hold.
      const holds = moduleRef.get(CreditReservationRepository);
      const countHolds = holds.sumOpenKeyHolds.bind(holds);
      jest.spyOn(holds, "sumOpenKeyHolds").mockImplementation(async (...args) => {
        const held = await countHolds(...args);
        await new Promise((resolve) => setTimeout(resolve, CHECK_PAUSE_MS));
        return held;
      });

      const actual = await Promise.all([complete(), complete()]);

      expect(actual.map((res) => res.statusCode).sort()).toEqual([200, 402]);
      const entries = await prisma.creditLedgerEntry.findMany({ where: { apiKeyId: key.id, type: "usage" } });
      expect(entries.map((entry) => entry.amount.toFixed(6))).toEqual([`-${CALL_CREDITS}`, `-${CALL_CREDITS}`]);
      expect(await prisma.creditReservation.count({ where: { apiKeyId: key.id } })).toBe(2);
    });
  });

  describe("AC4: the month is the Asia/Jakarta calendar month", () => {
    it("usage on the last Jakarta day of October counts in October; the Jakarta November (still 31 October in UTC) starts at zero", async () => {
      const key = await createKeyUser({ monthlyCreditCap: "0.1" });
      // 23:30 WIB on 31 October.
      await pastUsage(key, "0.1", new Date("2026-10-31T16:30:00.000Z"));
      fake.enqueue({ content: "Hello", usage: CALL_USAGE });

      fakeDateOnly(new Date("2026-10-31T16:45:00.000Z")); // 23:45 WIB, 31 October
      const inOctober = await complete();
      jest.setSystemTime(new Date("2026-10-31T17:15:00.000Z")); // 00:15 WIB, 1 November; 31 October in UTC
      const inNovember = await complete();

      expect(inOctober.statusCode).toBe(402);
      expect(inNovember.statusCode).toBe(200);
    });

    it("usage at 00:30 WIB on 1 October (30 September in UTC) counts in the Jakarta October", async () => {
      const key = await createKeyUser({ monthlyCreditCap: "0.1" });
      await pastUsage(key, "0.1", new Date("2026-09-30T17:30:00.000Z"));
      fakeDateOnly(new Date("2026-10-15T05:00:00.000Z"));

      const actual = await complete();

      expect(actual.statusCode).toBe(402);
    });
  });

  it("AC5: a call made with a key records that key on its usage entry and its reservation", async () => {
    const key = await createKeyUser();
    fake.enqueue({ content: "Hello", usage: CALL_USAGE });

    await complete();

    const entries = await prisma.creditLedgerEntry.findMany({ where: { type: "usage" } });
    const reservations = await prisma.creditReservation.findMany();
    expect(entries.map((entry) => entry.apiKeyId)).toEqual([key.id]);
    expect(reservations.map((reservation) => reservation.apiKeyId)).toEqual([key.id]);
  });

  describe("AC7: the credits used", () => {
    it("a non-stream call answers X-Credits-Used, the credits of its usage entry", async () => {
      await createKeyUser();
      fake.enqueue({ content: "Hello", usage: CALL_USAGE });

      const actual = await complete();

      const [entry] = await prisma.creditLedgerEntry.findMany({ where: { type: "usage" } });
      expect(actual.statusCode).toBe(200);
      expect(actual.headers["x-credits-used"]).toBe(CALL_CREDITS);
      expect(actual.headers["x-credits-used"]).toBe(entry.amount.negated().toFixed(6));
    });

    it.each([
      ["without include_usage (on the finish chunk)", {}],
      ["with include_usage (on the usage chunk)", { stream_options: { include_usage: true } }],
    ])("a stream: the last event before [DONE] carries credits_used, %s", async (_name, payload) => {
      await createKeyUser();
      fake.enqueue({ content: "Hello there", usage: CALL_USAGE });

      const actual = await complete({ stream: true, ...payload });

      const data = sseData(actual.body);
      expect(data.pop()).toBe("[DONE]");
      expect(JSON.parse(data.pop()!)).toMatchObject({ object: "chat.completion.chunk", credits_used: CALL_CREDITS });
      expect(data.filter((event) => event.includes("credits_used"))).toHaveLength(0);
    });
  });
});
