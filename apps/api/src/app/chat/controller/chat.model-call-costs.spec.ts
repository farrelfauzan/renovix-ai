import { ConfigModule } from "@nestjs/config";
import { Logger } from "@nestjs/common";
import { TestingModule } from "@nestjs/testing";
import { NestFastifyApplication } from "@nestjs/platform-fastify";
import { Decimal } from "@prisma/client/runtime/client";
import type { Prisma } from "@generated/prisma/client.js";
import { ChatController } from "./chat.controller";
import { ChatService } from "../service/chat.service";
import { PromptTuningService } from "../service/prompt-tuning.service";
import { ConversationService } from "../service/conversation.service";
import { CreditService } from "../../billing/service/credit.service";
import { UsageService } from "../../usage/service/usage.service";
import { DocumentService } from "../../document/service/document.service";
import { ModelRegistryService } from "../../config/model-registry.service";
import { ModelCallCostRepository } from "../../model-call-costs/repository/model-call-cost.repository";
import { ProvidersModule } from "../../providers/providers.module";
import { PrismaService } from "../../prisma/prisma.service";
import { createFastifyApp, createTestModule } from "../../../../test/test-module";
import { resetDatabase } from "../../../../test/test-database";
import { createApiKey, createUser } from "../../../../test/factories";
import { fundPaidWallet } from "../../../../test/credit-funding";
import { createResolvableModel } from "../../../../test/provider-model";
import { blockOutbound, OutboundBlocker, sendJson, sendSse, startStubHttpServer, StubHttpServer } from "../../../../test/llm-stub";

// RNX-162: each model call on POST /chat/completions (JSON and stream, and each failed attempt of a failover) writes
// one model_call_costs row right after its usage entry, end to end on the test database. Model M (slug rnx162/m) is on
// provider record P1, its fallback F (slug rnx162/f) on P2; both are local stubs, every other host is blocked. Real
// ChatService, CreditService, ModelCallCostService, ModelRegistryService, ProviderRouter and OpenRouterAdapter.
jest.mock("../service/prompt-tuning.service", () => ({ PromptTuningService: class {} }));
jest.mock("../service/conversation.service", () => ({ ConversationService: class {} }));
jest.mock("../../document/service/document.service", () => ({ DocumentService: class {} }));

let apiKey: string;
const M_SLUG = "rnx162/m";
const F_SLUG = "rnx162/f";
/** USD per token: input, cached input, output. */
const PRICES = { inputPrice: "0.000001", cachedInputPrice: "0.0000005", outputPrice: "0.000002" };
const RATE = "16250.5";
const MARKER = "RNX162-MARKER-7f3a";
const realSetTimeout = global.setTimeout;

type ProviderCost = Partial<Pick<Prisma.ProviderUncheckedCreateInput, "costMultiplier" | "perCallFloorUsd" | "highCaseFactor" | "highCaseTokenThreshold">>;

describe("RNX-162: model call costs on POST /chat/completions (Fastify, test database)", () => {
  let p1: StubHttpServer;
  let p2: StubHttpServer;
  let blocker: OutboundBlocker;
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let app: NestFastifyApplication;
  let errors: string[];

  beforeAll(async () => {
    [p1, p2] = await Promise.all([startStubHttpServer(), startStubHttpServer()]);
    ({ moduleRef, prisma } = await createTestModule({
      imports: [ConfigModule.forRoot({ isGlobal: true, ignoreEnvFile: true }), ProvidersModule],
      controllers: [ChatController],
      providers: [
        ChatService,
        CreditService,
        UsageService,
        ModelRegistryService,
        {
          provide: PromptTuningService,
          useValue: { applyTuning: async (messages: unknown) => ({ tunedMessages: messages, matchedTemplate: null }) },
        },
        { provide: ConversationService, useValue: {} },
        { provide: DocumentService, useValue: {} },
      ],
    }));
    app = await createFastifyApp(moduleRef);
  });

  beforeEach(async () => {
    blocker = blockOutbound();
    for (const stub of [p1, p2]) stub.requests.length = 0;
    await resetDatabase(prisma);
    await prisma.tierRate.create({ data: { tier: "standard", inputCreditsPerToken: 1, cachedCreditsPerToken: 1, outputCreditsPerToken: 1 } });
    const user = await createUser(prisma);
    apiKey = await createApiKey(prisma, user.id);
    await fundPaidWallet(prisma, user.id, 50);
    errors = [];
    jest.spyOn(Logger.prototype, "error").mockImplementation((message: unknown) => void errors.push(String(message)));
    // The adapter's retry back-off (2 s .. 60 s) runs at once; every other timer is untouched.
    jest.spyOn(global, "setTimeout").mockImplementation(((fn: () => void, ms?: number) =>
      realSetTimeout(fn, ms && ms >= 2000 && ms <= 60000 && /openrouter\.adapter/.test(new Error().stack ?? "") ? 0 : ms)) as typeof setTimeout);
  });

  afterEach(() => {
    blocker.restore();
    jest.restoreAllMocks();
  });

  afterAll(async () => {
    await app?.close();
    await Promise.all([p1?.close(), p2?.close()]);
  });

  /** Today's date at UTC midnight, `daysAgo` days back. */
  const utcDate = (daysAgo = 0) => {
    const now = new Date();
    return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - daysAgo));
  };

  const seedRate = (daysAgo = 0) =>
    prisma.exchangeRate.create({ data: { base: "USD", quote: "IDR", rate: RATE, rateDate: utcDate(daysAgo), fetchedAt: new Date(), source: "frankfurter" } });

  /** M on P1 with PRICES and P1's cost settings; the registry reloaded. */
  const modelM = async (cost: ProviderCost = {}) => {
    const m = await createResolvableModel(prisma, { slug: M_SLUG, ...PRICES, provider: { baseUrl: p1.baseUrl, ...cost } });
    await moduleRef.get(ModelRegistryService).refresh();
    return m;
  };

  /** A chat completion with this usage report. */
  const completion = (content: string, usage: Record<string, unknown>) => ({
    id: "gen-rnx162",
    choices: [{ message: { role: "assistant", content }, finish_reason: "stop" }],
    usage,
  });

  const answerJson = (stub: StubHttpServer, content: string, usage: Record<string, unknown>) =>
    stub.respond((_r, res) => sendJson(res, 200, completion(content, usage)));

  const chat = (payload: Record<string, unknown> = {}) =>
    app.inject({
      method: "POST",
      url: "/chat/completions",
      headers: { authorization: `Bearer ${apiKey}` },
      payload: { model: M_SLUG, messages: [{ role: "user", content: "Hi" }], ...payload },
    });

  const usageEntries = () => prisma.creditLedgerEntry.findMany({ where: { type: "usage" }, orderBy: { seq: "asc" } });
  const costRows = () => prisma.modelCallCost.findMany({ orderBy: { createdAt: "asc" } });
  const fixed = (value: Decimal | null) => value?.toFixed(12) ?? null;

  /** The usage_logs row (written in the background after the answer); waits up to 2 s for it. */
  const usageLogRows = async () => {
    for (let attempt = 0; attempt < 40; attempt++) {
      const rows = await prisma.usageLog.findMany();
      if (rows.length) return rows;
      await new Promise((resolve) => realSetTimeout(resolve, 50));
    }
    throw new Error("no usage_logs row was written");
  };

  describe("AC1: the token-price figure and the rupiah amount (chat JSON path)", () => {
    it("one row for the call: new x input + cached x cached + output x output in USD, x the seeded rate in rupiah, the rate stored", async () => {
      const m = await modelM();
      await seedRate();
      answerJson(p1, "Hello", { prompt_tokens: 1400, completion_tokens: 200, total_tokens: 1600, prompt_tokens_details: { cached_tokens: 400 } });

      const res = await chat();

      expect(res.statusCode).toBe(200);
      const [entry] = await usageEntries();
      const rows = await prisma.modelCallCost.findMany({ where: { callId: entry.callId! } });
      expect(rows).toHaveLength(1);
      const [row] = rows;
      // 1000 x 0.000001 + 400 x 0.0000005 + 200 x 0.000002 = 0.001 + 0.0002 + 0.0004
      const expectedUsd = new Decimal(1000).mul(PRICES.inputPrice).plus(new Decimal(400).mul(PRICES.cachedInputPrice)).plus(new Decimal(200).mul(PRICES.outputPrice));
      expect(expectedUsd.toFixed(12)).toBe("0.001600000000");
      expect([row.tokensNew, row.tokensCached, row.tokensOut, row.tokensReasoning]).toEqual([1000, 400, 200, null]);
      expect(fixed(row.tokenPriceUsd)).toBe(expectedUsd.toFixed(12));
      expect([fixed(row.costLowUsd), fixed(row.costHighUsd)]).toEqual([expectedUsd.toFixed(12), expectedUsd.toFixed(12)]);
      expect(row.costLowIdr?.toFixed(12)).toBe(expectedUsd.mul(RATE).toFixed(12));
      expect(row.costLowIdr?.toFixed(4)).toBe("26.0008");
      expect(row.costHighIdr?.toFixed(12)).toBe(expectedUsd.mul(RATE).toFixed(12));
      expect(row.exchangeRate?.toFixed(1)).toBe(RATE);
      expect(row.exchangeRateDate).toEqual(utcDate());
      expect(row).toMatchObject({
        providerId: m.provider.id,
        providerModelId: M_SLUG,
        reportedCostUsd: null,
        wallet: "paid",
        workspaceId: null,
        tier: "standard",
      });
    });

    it("no usable rate (8 days old): the rupiah figures and the rate are null, the USD figures still stored", async () => {
      await modelM();
      await seedRate(8);
      answerJson(p1, "Hello", { prompt_tokens: 1000, completion_tokens: 200, total_tokens: 1200 });

      const res = await chat();

      expect(res.statusCode).toBe(200);
      const [row] = await costRows();
      expect(fixed(row.costLowUsd)).toBe("0.001400000000");
      expect([row.costLowIdr, row.costHighIdr, row.exchangeRate, row.exchangeRateDate]).toEqual([null, null, null, null]);
    });
  });

  describe("AC2: the provider's per-call floor", () => {
    it("a tiny call: low = the floor", async () => {
      await modelM({ perCallFloorUsd: "0.01" });
      answerJson(p1, "Hi", { prompt_tokens: 3, completion_tokens: 2, total_tokens: 5 });

      await chat();

      const [row] = await costRows();
      expect(fixed(row.tokenPriceUsd)).toBe("0.000007000000");
      expect(fixed(row.costLowUsd)).toBe("0.010000000000");
    });

    it("control: a large call (token price above the floor): low = the token-price figure", async () => {
      await modelM({ perCallFloorUsd: "0.01" });
      answerJson(p1, "Hi", { prompt_tokens: 10000, completion_tokens: 5000, total_tokens: 15000 });

      await chat();

      const [row] = await costRows();
      expect(fixed(row.tokenPriceUsd)).toBe("0.020000000000");
      expect(fixed(row.costLowUsd)).toBe("0.020000000000");
    });
  });

  describe("AC3: the reported cost, the provider multiplier and the high case", () => {
    it("a reported cost of 0.10 USD with multiplier 1.5: low = 0.15 USD, the token-price figure stored too; high case off: high = low", async () => {
      await modelM({ costMultiplier: "1.5" });
      answerJson(p1, "Hi", { prompt_tokens: 1000, completion_tokens: 200, total_tokens: 1200, cost: 0.1 });

      await chat();

      const [row] = await costRows();
      expect(fixed(row.reportedCostUsd)).toBe("0.100000000000");
      expect(fixed(row.tokenPriceUsd)).toBe("0.001400000000");
      expect(fixed(row.costLowUsd)).toBe("0.150000000000");
      expect(fixed(row.costHighUsd)).toBe("0.150000000000");
    });

    it("control: no reported cost: low = the token-price figure", async () => {
      await modelM({ costMultiplier: "1.5" });
      answerJson(p1, "Hi", { prompt_tokens: 1000, completion_tokens: 200, total_tokens: 1200 });

      await chat();

      const [row] = await costRows();
      expect(row.reportedCostUsd).toBeNull();
      expect(fixed(row.costLowUsd)).toBe("0.001400000000");
    });

    it("high case on (factor 1.5, threshold below the call's 1200 tokens): high = 1.5 x low, stored separately", async () => {
      await modelM({ costMultiplier: "1.5", highCaseFactor: "1.5", highCaseTokenThreshold: 1000 });
      answerJson(p1, "Hi", { prompt_tokens: 1000, completion_tokens: 200, total_tokens: 1200, cost: 0.1 });

      await chat();

      const [row] = await costRows();
      expect(fixed(row.costLowUsd)).toBe("0.150000000000");
      expect(fixed(row.costHighUsd)).toBe("0.225000000000");
    });

    it("the reported reasoning tokens are stored (part of the output tokens)", async () => {
      await modelM();
      answerJson(p1, "Hi", { prompt_tokens: 10, completion_tokens: 50, total_tokens: 60, completion_tokens_details: { reasoning_tokens: 30 } });

      await chat();

      const [row] = await costRows();
      expect([row.tokensOut, row.tokensReasoning]).toEqual([50, 30]);
    });
  });

  it("AC4 (negative): a marker in the prompt and in the answer appears in no usage, ledger or model_call_costs row", async () => {
    await modelM();
    answerJson(p1, `answer ${MARKER}`, { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 });

    const res = await chat({ messages: [{ role: "user", content: `prompt ${MARKER}` }] });

    expect(res.statusCode).toBe(200);
    expect(res.json().choices[0].message.content).toContain(MARKER);
    const rows = { usageLogs: await usageLogRows(), ledger: await prisma.creditLedgerEntry.findMany(), costs: await costRows() };
    expect(rows.costs).toHaveLength(1);
    expect(JSON.stringify(rows)).not.toContain(MARKER);
  });

  it("AC5: a provider error charged 0 mid-stream: the usage entry records the reported tokens, and a cost row with our cost exists", async () => {
    await modelM();
    const usage = { prompt_tokens: 1000, completion_tokens: 200, total_tokens: 1200 };
    p1.respond((_r, res) =>
      sendSse(res, [
        JSON.stringify({ choices: [{ delta: { content: "Partial " } }] }),
        JSON.stringify({ choices: [], usage }),
        JSON.stringify({ error: { code: 502, message: "provider down" }, choices: [{ finish_reason: "error" }] }),
      ]),
    );

    const res = await chat({ stream: true });

    expect(res.statusCode).toBe(200);
    const [entry] = await usageEntries();
    expect([entry.outcome, entry.amount.toFixed(6), entry.tokensNew, entry.tokensCached, entry.tokensOut]).toEqual(["provider_error", "0.000000", 1000, 0, 200]);
    const [row] = await costRows();
    expect(row.callId).toBe(entry.callId);
    expect(fixed(row.costLowUsd)).toBe("0.001400000000");
  });

  it("AC7 (transaction boundary): a failing cost write leaves the model call successful and its usage entry written", async () => {
    await modelM();
    answerJson(p1, "Hello", { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 });
    jest.spyOn(moduleRef.get(ModelCallCostRepository), "create").mockRejectedValueOnce(new Error(`planted cost write failure ${MARKER}`));

    const res = await chat();

    expect(res.statusCode).toBe(200);
    expect(res.json().choices[0].message.content).toBe("Hello");
    const entries = await usageEntries();
    expect(entries.map((e) => [e.outcome, e.amount.toFixed(6)])).toEqual([["completed", "-0.000015"]]);
    expect(await costRows()).toEqual([]);
    expect(errors).toContain(`Failed to record the model call cost of call ${entries[0].callId}`);
    expect(errors.join("\n")).not.toContain(MARKER);
  });

  describe("AC8: one row per model call on each chat path", () => {
    it("the chat stream path: one row for the call, from the stream's usage chunk (reported cost included)", async () => {
      await modelM();
      p1.respond((_r, res) =>
        sendSse(res, [
          JSON.stringify({ choices: [{ delta: { content: "Hello" } }] }),
          JSON.stringify({ choices: [{ delta: {}, finish_reason: "stop" }] }),
          JSON.stringify({ choices: [], usage: { prompt_tokens: 1000, completion_tokens: 200, total_tokens: 1200, cost: 0.002, completion_tokens_details: { reasoning_tokens: 20 } } }),
        ]),
      );

      const res = await chat({ stream: true });

      expect(res.statusCode).toBe(200);
      const [entry] = await usageEntries();
      const rows = await costRows();
      expect(rows.map((r) => [r.callId, fixed(r.reportedCostUsd), fixed(r.tokenPriceUsd), fixed(r.costLowUsd), r.tokensReasoning])).toEqual([
        [entry.callId, "0.002000000000", "0.001400000000", "0.002000000000", 20],
      ]);
    });

    it("RNX-179's failover: a row for the failed attempt (M on P1) and one for the served call (F on P2)", async () => {
      const m = await createResolvableModel(prisma, { slug: M_SLUG, ...PRICES, provider: { baseUrl: p1.baseUrl } });
      const f = await createResolvableModel(prisma, { slug: F_SLUG, ...PRICES, provider: { baseUrl: p2.baseUrl } });
      await prisma.aiModelFallback.create({ data: { modelId: m.model.id, fallbackModelId: f.model.id, position: 0 } });
      await moduleRef.get(ModelRegistryService).refresh();
      p1.respond((_r, res) => sendJson(res, 503, { error: "down" }));
      answerJson(p2, "from P2", { prompt_tokens: 1000, completion_tokens: 200, total_tokens: 1200 });

      const res = await chat();

      expect(res.statusCode).toBe(200);
      const entries = await usageEntries();
      const rows = await costRows();
      const rowOf = (callId: string | null) => rows.find((r) => r.callId === callId);
      expect(rows).toHaveLength(2);
      expect(entries.map((e) => e.outcome)).toEqual(["provider_error", "completed"]);
      const failed = rowOf(entries[0].callId);
      const served = rowOf(entries[1].callId);
      expect([failed?.providerId, failed?.providerModelId, failed?.tokensNew, failed?.tokensOut, fixed(failed?.costLowUsd ?? null)]).toEqual([
        m.provider.id, M_SLUG, 0, 0, "0.000000000000",
      ]);
      expect([served?.providerId, served?.providerModelId, fixed(served?.costLowUsd ?? null)]).toEqual([f.provider.id, F_SLUG, "0.001400000000"]);
    });
  });
});
