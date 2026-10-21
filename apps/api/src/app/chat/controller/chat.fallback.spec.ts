import { ConfigModule } from "@nestjs/config";
import { Logger } from "@nestjs/common";
import { TestingModule } from "@nestjs/testing";
import { NestFastifyApplication } from "@nestjs/platform-fastify";
import { ChatController } from "./chat.controller";
import { ChatService } from "../service/chat.service";
import { PromptTuningService } from "../service/prompt-tuning.service";
import { ConversationService } from "../service/conversation.service";
import { CreditService } from "../../billing/service/credit.service";
import { UsageService } from "../../usage/service/usage.service";
import { DocumentService } from "../../document/service/document.service";
import { ModelRegistryService } from "../../config/model-registry.service";
import { AdminProvidersService } from "../../admin-providers/service/admin-providers.service";
import { AdminProviderModelsService } from "../../admin-providers/service/admin-provider-models.service";
import { ProvidersModule } from "../../providers/providers.module";
import { PrismaService } from "../../prisma/prisma.service";
import { TransactionService } from "../../prisma/transaction.service";
import { createFastifyApp, createTestModule } from "../../../../test/test-module";
import { resetDatabase } from "../../../../test/test-database";
import { createUser } from "../../../../test/factories";
import { fundPaidWallet } from "../../../../test/credit-funding";
import { assertCreditLedgerInvariants } from "../../../../test/credit-ledger-invariants";
import { createResolvableModel } from "../../../../test/provider-model";
import { sseErrorMessages } from "../../../../test/sse-client";
import {
  blockOutbound,
  chatCompletion,
  OutboundBlocker,
  sendJson,
  sendSse,
  startStubHttpServer,
  StubHttpServer,
} from "../../../../test/llm-stub";

// RNX-179 (D58, D148, D149): POST /chat/completions with per-model fallback models, end to end on the test database.
// Model M (slug cc/x) is on provider record P1, its fallback F (slug y) on P2; both are local stubs, every other host
// is blocked. The fallback list is set through AdminProviderModelsService (the PATCH route's service). Real
// ChatService, CreditService, UsageService, ModelRegistryService, ProviderRouter and OpenRouterAdapter.
jest.mock("../service/prompt-tuning.service", () => ({ PromptTuningService: class {} }));
jest.mock("../service/conversation.service", () => ({ ConversationService: class {} }));
jest.mock("../../document/service/document.service", () => ({ DocumentService: class {} }));

const P1_KEY = "rnx179-marker-key-not-real-p1";
const P2_KEY = "rnx179-marker-key-not-real-p2";
const API_KEY = "sk_live_rnx179-test-key";
const M_SLUG = "cc/x";
const F_SLUG = "y";
/** docs/credits.md tier rates (credits per 1,000,000 tokens: new / cached / output). */
const RATES = {
  standard: { inputCreditsPerToken: 1, cachedCreditsPerToken: 1, outputCreditsPerToken: 1 },
  advanced: { inputCreditsPerToken: 5, cachedCreditsPerToken: 6, outputCreditsPerToken: 4 },
};
/** The stubs' usage report (llm-stub chatCompletion): 3 prompt tokens, 2 completion tokens. */
const USAGE = { prompt_tokens: 3, completion_tokens: 2, total_tokens: 5 };
const realSetTimeout = global.setTimeout;

describe("RNX-179: fallback models on POST /chat/completions (Fastify, test database)", () => {
  let p1: StubHttpServer;
  let p2: StubHttpServer;
  let blocker: OutboundBlocker;
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let app: NestFastifyApplication;
  let registry: ModelRegistryService;
  let warnings: string[];

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
        AdminProvidersService,
        AdminProviderModelsService,
        {
          provide: PromptTuningService,
          useValue: { applyTuning: async (messages: unknown) => ({ tunedMessages: messages, matchedTemplate: null }) },
        },
        { provide: ConversationService, useValue: {} },
        { provide: DocumentService, useValue: {} },
      ],
    }));
    app = await createFastifyApp(moduleRef);
    registry = moduleRef.get(ModelRegistryService);
  });

  beforeEach(async () => {
    blocker = blockOutbound();
    for (const stub of [p1, p2]) {
      stub.requests.length = 0;
      stub.respond((_r, res) => sendJson(res, 200, chatCompletion(`from ${stub === p1 ? "P1" : "P2"}`)));
    }
    await resetDatabase(prisma);
    await prisma.tierRate.createMany({ data: Object.entries(RATES).map(([tier, rates]) => ({ tier, ...rates })) });
    warnings = [];
    jest.spyOn(Logger.prototype, "warn").mockImplementation((message: unknown) => void warnings.push(String(message)));
    // The adapter's retry back-off (2 s .. 60 s) runs at once; every other timer (Prisma's transaction timeout too)
    // is untouched.
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

  const inTransaction = <T>(write: (tx: Parameters<Parameters<TransactionService["run"]>[0]>[0]) => Promise<T>) =>
    moduleRef.get(TransactionService).run(write);

  /** M on P1 and F on P2 (two provider records), F set as M's only fallback through the admin service; registry reloaded. */
  const modelWithFallback = async ({ mTier, fTier }: { mTier: string; fTier: string }) => {
    const m = await createResolvableModel(prisma, { slug: M_SLUG, tier: mTier, provider: { baseUrl: p1.baseUrl, apiKey: P1_KEY } });
    const f = await createResolvableModel(prisma, { slug: F_SLUG, tier: fTier, provider: { baseUrl: p2.baseUrl, apiKey: P2_KEY } });
    await inTransaction((tx) => moduleRef.get(AdminProviderModelsService).update(m.provider.id, m.model.id, { fallbackModelIds: [f.model.id] }, tx));
    await registry.refresh();
    return { m, f };
  };

  const fundedUser = async () => {
    const user = await createUser(prisma, { apiKey: API_KEY });
    await fundPaidWallet(prisma, user.id, 5);
    return user;
  };

  const chat = (payload: Record<string, unknown> = {}) =>
    app.inject({
      method: "POST",
      url: "/chat/completions",
      headers: { authorization: `Bearer ${API_KEY}` },
      payload: { model: M_SLUG, messages: [{ role: "user", content: "Hi" }], ...payload },
    });

  /** The usage ledger entries in ledger order (outcome, model, tier, amount, uncharged, tokens new/cached/out). */
  const usageEntries = async () =>
    (await prisma.creditLedgerEntry.findMany({ where: { type: "usage" }, orderBy: { seq: "asc" } })).map((e) => [
      e.outcome,
      e.modelId,
      e.tier,
      e.amount.toFixed(6),
      e.uncharged.toFixed(6),
      [e.tokensNew, e.tokensCached, e.tokensOut],
    ]);

  /** Every reservation (status, consumed) and the paid wallet's held, after the request. */
  const reservationState = async () => ({
    reservations: (await prisma.creditReservation.findMany()).map((r) => [r.status, r.consumed.toFixed(6)]),
    held: (await prisma.creditAccount.findFirstOrThrow({ where: { wallet: "paid" } })).held.toFixed(6),
    requestIds: [...new Set((await prisma.creditLedgerEntry.findMany({ where: { type: "usage" } })).map((e) => e.requestId))].length,
  });
  /** A failed attempt's entry (rule 6): provider_error, charged 0, nothing uncharged, no tokens. */
  const failedEntry = (slug: string, tier: string) => ["provider_error", slug, tier, "0.000000", "0.000000", [0, 0, 0]];
  /** The served call's entry at M's (advanced) rate for the stubs' usage (3 new, 0 cached, 2 out). */
  const servedEntry = (slug: string) => ["completed", slug, "advanced", "-0.000023", "0.000000", [3, 0, 2]];

  /** The usage_logs row (written in the background after the answer); waits up to 2 s for it. */
  const usageLogRow = async () => {
    for (let attempt = 0; attempt < 40; attempt++) {
      const row = await prisma.usageLog.findFirst();
      if (row) return row;
      await new Promise((resolve) => realSetTimeout(resolve, 50));
    }
    throw new Error("no usage_logs row was written");
  };

  /** M's (advanced) rate for the stubs' usage: 3 × 5 + 2 × 4 = 23 micro-credits. F's (standard) would be 3 + 2 = 5. */
  const AT_M_RATE = "-0.000023";

  it("AC1: P1 answers 503 → P2 receives model y with P2's key; the client gets P2's answer", async () => {
    await modelWithFallback({ mTier: "standard", fTier: "standard" });
    await fundedUser();
    p1.respond((_r, res) => sendJson(res, 503, { error: "down" }));

    const res = await chat();

    expect(res.statusCode).toBe(200);
    expect(res.json().choices[0].message.content).toBe("from P2");
    expect(p1.requests.map((r) => r.body.model)).toEqual([M_SLUG]);
    expect(p2.requests).toHaveLength(1);
    expect(p2.requests[0].body.model).toBe(F_SLUG);
    expect(p2.requests[0].headers.authorization).toBe(`Bearer ${P2_KEY}`);
    expect(blocker.blocked).toEqual([]);
  });

  it("AC2 (negative): P1 answers 400 → the 400's fixed error, P2 receives nothing, charged 0", async () => {
    await modelWithFallback({ mTier: "standard", fTier: "standard" });
    await fundedUser();
    p1.respond((_r, res) => sendJson(res, 400, { error: "bad request" }));

    const res = await chat();

    expect(res.statusCode).toBe(500);
    expect(p2.requests).toHaveLength(0);
    expect(await usageEntries()).toEqual([failedEntry(M_SLUG, "standard")]);
    await assertCreditLedgerInvariants(prisma);
  });

  it("regression: a 503 on a model without a fallback writes exactly one provider_error entry and releases the hold", async () => {
    await createResolvableModel(prisma, { slug: M_SLUG, tier: "standard", provider: { baseUrl: p1.baseUrl, apiKey: P1_KEY } });
    await registry.refresh();
    await fundedUser();
    p1.respond((_r, res) => sendJson(res, 503, { error: "down" }));

    const res = await chat();

    expect(res.statusCode).toBe(500);
    expect(await usageEntries()).toEqual([failedEntry(M_SLUG, "standard")]);
    expect(await reservationState()).toEqual({ reservations: [["released", "0.000000"]], held: "0.000000", requestIds: 1 });
    await assertCreditLedgerInvariants(prisma);
  });

  it("AC4: a failover from M (advanced) to the cheaper F (standard): a provider_error entry for M, then F's call at M's rate, one reservation settled once; usage_logs names F and P2", async () => {
    const { f } = await modelWithFallback({ mTier: "advanced", fTier: "standard" });
    const user = await fundedUser();
    p1.respond((_r, res) => sendJson(res, 503, { error: "down" }));

    const res = await chat();

    expect(res.statusCode).toBe(200);
    expect(res.json().usage).toEqual(USAGE);
    expect(await usageEntries()).toEqual([failedEntry(M_SLUG, "advanced"), servedEntry(F_SLUG)]);
    expect(await reservationState()).toEqual({ reservations: [["settled", AT_M_RATE.slice(1)]], held: "0.000000", requestIds: 1 });
    const row = await usageLogRow();
    expect([row.userId, row.model, row.provider, row.cost.toFixed(6)]).toEqual([user.id, F_SLUG, f.provider.name, AT_M_RATE.slice(1)]);
    await assertCreditLedgerInvariants(prisma);
  });

  it("AC4 control: no failover → usage_logs names M and P1, the same charge", async () => {
    const { m } = await modelWithFallback({ mTier: "advanced", fTier: "standard" });
    await fundedUser();

    await chat();

    expect(await usageEntries()).toEqual([servedEntry(M_SLUG)]);
    const row = await usageLogRow();
    expect([row.model, row.provider]).toEqual([M_SLUG, m.provider.name]);
    expect(p2.requests).toHaveLength(0);
  });

  it("AC3 (call time): F's tier raised to premium after it was set → F is skipped and the skip is logged; P1's 503 reaches the client", async () => {
    const { f } = await modelWithFallback({ mTier: "standard", fTier: "standard" });
    await fundedUser();
    await inTransaction((tx) => moduleRef.get(AdminProviderModelsService).update(f.provider.id, f.model.id, { tier: "premium" }, tx));
    await registry.refresh();
    p1.respond((_r, res) => sendJson(res, 503, { error: "down" }));

    const res = await chat();

    expect(res.statusCode).toBe(500);
    expect(p2.requests).toHaveLength(0);
    expect(warnings.filter((w) => w.includes(`fallback ${F_SLUG} of ${M_SLUG} skipped: its tier premium is above standard`)).length).toBeGreaterThan(0);
    expect(await usageEntries()).toEqual([failedEntry(M_SLUG, "standard")]);
  });

  describe("AC6: streams", () => {
    const P2_STREAM = [
      '{"choices":[{"delta":{"content":"from P2"}}]}',
      '{"choices":[{"delta":{},"finish_reason":"stop"}]}',
      `{"choices":[],"usage":${JSON.stringify(USAGE)}}`,
    ];

    it("P1 answers 503 before the first byte → F streams the answer: a provider_error entry for M, then F's call at M's rate, one reservation settled once; usage_logs names F and P2", async () => {
      const { f } = await modelWithFallback({ mTier: "advanced", fTier: "standard" });
      await fundedUser();
      p1.respond((_r, res) => sendJson(res, 503, { error: "down" }));
      p2.respond((_r, res) => sendSse(res, P2_STREAM));

      const res = await chat({ stream: true });

      expect([res.statusCode, res.headers["content-type"]]).toEqual([200, "text/event-stream"]);
      expect(res.body).toContain('"content":"from P2"');
      expect(res.body).toContain("data: [DONE]");
      expect(p2.requests[0].body).toMatchObject({ model: F_SLUG, stream: true });
      expect(await usageEntries()).toEqual([failedEntry(M_SLUG, "advanced"), servedEntry(F_SLUG)]);
      expect(await reservationState()).toEqual({ reservations: [["settled", AT_M_RATE.slice(1)]], held: "0.000000", requestIds: 1 });
      const row = await usageLogRow();
      expect([row.model, row.provider]).toEqual([F_SLUG, f.provider.name]);
      await assertCreditLedgerInvariants(prisma);
    });

    it("negative: P1 fails after its first byte (a 502 error chunk) → the client gets an error event; P2 receives nothing", async () => {
      await modelWithFallback({ mTier: "standard", fTier: "standard" });
      await fundedUser();
      p1.respond((_r, res) =>
        sendSse(res, ['{"choices":[{"delta":{"content":"Partial "}}]}', '{"error":{"code":502,"message":"upstream gone"},"choices":[{"delta":{},"finish_reason":"error"}]}']),
      );

      const res = await chat({ stream: true });

      expect(res.body).toContain('"content":"Partial "');
      expect(sseErrorMessages(res.body)).toEqual(["Provider request failed (502). No credits were charged."]);
      expect(res.body).not.toContain("[DONE]");
      expect(p2.requests).toHaveLength(0);
    });
  });
});
