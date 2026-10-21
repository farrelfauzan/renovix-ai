import { randomUUID } from "node:crypto";
import type { ServerResponse } from "node:http";
import { ConfigModule } from "@nestjs/config";
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
import { ProvidersModule } from "../../providers/providers.module";
import { HealthController } from "../../health/controller/health.controller";
import { PrismaService } from "../../prisma/prisma.service";
import { createFastifyApp, createTestModule } from "../../../../test/test-module";
import { resetDatabase } from "../../../../test/test-database";
import { createUser, createApiKey, testApiKey } from "../../../../test/factories";
import { fundPaidWallet } from "../../../../test/credit-funding";
import { assertCreditLedgerInvariants } from "../../../../test/credit-ledger-invariants";
import {
  blockOutbound,
  OutboundBlocker,
  pointLlmAtStubs,
  sendJson,
  startStubHttpServer,
  StubHttpServer,
} from "../../../../test/llm-stub";
import { createResolvableModel } from "../../../../test/provider-model";
import { captureLogs, sseErrorMessages } from "../../../../test/sse-client";
import { captureOutput } from "../../../../test/capture-output";
import { plantedProviderSecret } from "../../../../test/planted-provider-secret";

// RX-169: the API-key route POST /chat/completions never streams (its request
// schema has no `stream` field; ChatService calls ProviderRouter.chat). A
// provider 400 must reach the client in this route's format (HTTP 500 JSON,
// nothing charged: RX-22 writes a provider_error usage entry of 0 and releases the hold) with the process running: Jest fails the test on any
// uncaught exception or unhandled rejection. Real ChatController, ChatService
// and OpenRouterAdapter against a local stub; these collaborators load
// ESM-only packages.
jest.mock("../../usage/service/usage.service", () => ({ UsageService: class {} }));
jest.mock("../service/prompt-tuning.service", () => ({ PromptTuningService: class {} }));
jest.mock("../service/conversation.service", () => ({ ConversationService: class {} }));
jest.mock("../../document/service/document.service", () => ({ DocumentService: class {} }));

const PRIMARY_KEY = "rx169-marker-key-not-real-primary";
const API_KEY = testApiKey("rx169-test-key");

describe("RX-169: provider error on the API-key chat route (Fastify, test database)", () => {
  let primary: StubHttpServer;
  let blocker: OutboundBlocker;
  let restoreEnv: () => void;
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let app: NestFastifyApplication;

  beforeAll(async () => {
    primary = await startStubHttpServer();
    restoreEnv = pointLlmAtStubs({ primary, apiKey: PRIMARY_KEY });
    ({ moduleRef, prisma } = await createTestModule({
      imports: [ConfigModule.forRoot({ isGlobal: true, ignoreEnvFile: true }), ProvidersModule],
      controllers: [ChatController, HealthController],
      providers: [
        ChatService,
        CreditService,
        ModelRegistryService,
        {
          provide: PromptTuningService,
          useValue: {
            applyTuning: async (messages: unknown) => ({ tunedMessages: messages, matchedTemplate: null }),
          },
        },
        { provide: UsageService, useValue: {} },
        { provide: ConversationService, useValue: {} },
        { provide: DocumentService, useValue: {} },
      ],
    }));
    app = await createFastifyApp(moduleRef);
  });

  beforeEach(async () => {
    blocker = blockOutbound();
    primary.requests.length = 0;
    await resetDatabase(prisma);
    await createResolvableModel(prisma, {
      slug: "test-model",
      modelName: "test-model",
      inputPrice: 0.000001,
      outputPrice: 0.000001,
      maxTokens: 8192,
      provider: { baseUrl: primary.baseUrl, apiKey: PRIMARY_KEY },
    });
    // RX-21: charging reads the tier rate table (credits per 1,000,000 tokens); resetDatabase
    // wipes it, so seed the standard 1/1/1 rate with the model row.
    await prisma.tierRate.create({
      data: { tier: "standard", inputCreditsPerToken: 1, cachedCreditsPerToken: 1, outputCreditsPerToken: 1 },
    });
    await moduleRef.get(ModelRegistryService).refresh();
  });

  afterEach(() => {
    blocker.restore();
    jest.restoreAllMocks();
  });

  afterAll(async () => {
    await app?.close();
    await primary?.close();
    restoreEnv?.();
  });

  // RX-22: was "Your balance has been refunded." and a refundReservation call (old BillingService). Now the hold is
  // released and the call has one provider_error usage entry of amount 0; the balance is unchanged.
  it("AC7: provider answers 400 → HTTP 500 JSON, a provider_error entry of 0, the hold released, balance unchanged, health answers", async () => {
    primary.respond((_r, res) => sendJson(res, 400, { error: { message: "unknown model" } }));
    const user = await createUser(prisma);
    await createApiKey(prisma, user.id, { apiKey: API_KEY });
    await fundPaidWallet(prisma, user.id, 1);

    const res = await app.inject({
      method: "POST",
      url: "/chat/completions",
      headers: { authorization: `Bearer ${API_KEY}` },
      payload: { model: "test-model", messages: [{ role: "user", content: "Hi" }] },
    });

    expect(res.statusCode).toBe(500);
    // RNX-190 (D199): a 400 about the model is the typed "model not found" (was "Failed to get response from model
    // provider."); the status code stays 500.
    expect(res.json()).toMatchObject({
      statusCode: 500,
      message: "Model not found at the provider (400). No credits were charged.",
    });
    const usage = await prisma.creditLedgerEntry.findMany({ where: { memberUserId: user.id, type: "usage" } });
    expect(usage.map((e) => [e.outcome, e.amount.toFixed(6), e.uncharged.toFixed(6), e.tokensNew, e.tokensOut])).toEqual([
      ["provider_error", "0.000000", "0.000000", 0, 0],
    ]);
    expect((await prisma.creditReservation.findMany()).map((r) => [r.status, r.consumed.toFixed(6)])).toEqual([
      ["released", "0.000000"],
    ]);
    const account = await prisma.creditAccount.findUniqueOrThrow({ where: { userId_wallet: { userId: user.id, wallet: "paid" } } });
    expect([account.balance.toFixed(6), account.held.toFixed(6)]).toEqual(["1.000000", "0.000000"]);
    await assertCreditLedgerInvariants(prisma);
    expect(primary.requests).toHaveLength(1);
    expect(primary.requests[0].body.stream).toBeUndefined();
    const health = await app.inject({ method: "GET", url: "/health" });
    expect(health.statusCode).toBe(200);
  });

  it("RX-22: an unaffordable estimate → HTTP 402 CREDITS_EXHAUSTED (was 400 Insufficient balance), no provider call, nothing written", async () => {
    const user = await createUser(prisma);
    await createApiKey(prisma, user.id, { apiKey: API_KEY });
    await fundPaidWallet(prisma, user.id, "0.000001");

    const res = await app.inject({
      method: "POST",
      url: "/chat/completions",
      headers: { authorization: `Bearer ${API_KEY}` },
      payload: { model: "test-model", messages: [{ role: "user", content: "Hi" }] },
    });

    expect(res.statusCode).toBe(402);
    expect(res.json()).toMatchObject({ code: "CREDITS_EXHAUSTED" });
    expect(primary.requests).toHaveLength(0);
    expect(await prisma.creditReservation.count()).toBe(0);
    expect(await prisma.creditLedgerEntry.count({ where: { type: "usage" } })).toBe(0);
    await assertCreditLedgerInvariants(prisma);
  });

  // RNX-208 (D197, D208): with stream true (RNX-196) a provider error body (a planted marker and a fake key suffix, as a
  // 401 can echo, RX-174) reaches no log line and no SSE line; the client and the log get only the fixed texts.
  it.each([401, 400])("RNX-208: stream true, the provider answers %i with a marker in its body → the marker is in no log line and no SSE line", async (status) => {
    const marker = `LEAK-MARKER-${randomUUID()}`;
    const isLeak = (text: string) => text.includes(marker) || text.includes("FAKE1234") || text.includes("rx169-marker-key");
    const logs = captureLogs();
    primary.respond((_r, res) => sendJson(res, status, { error: { message: `Incorrect API key provided: ${marker} ...sk-or-v1-FAKE1234`, code: status } }));
    const user = await createUser(prisma);
    await createApiKey(prisma, user.id, { apiKey: API_KEY });
    await fundPaidWallet(prisma, user.id, 1);

    const res = await app.inject({
      method: "POST",
      url: "/chat/completions",
      headers: { authorization: `Bearer ${API_KEY}` },
      payload: { model: "test-model", messages: [{ role: "user", content: "Hi" }], stream: true },
    });

    const streamErrorLine = `OpenRouter stream error (${new URL(primary.baseUrl).host}, ${status})`;
    expect(primary.requests.map((r) => r.body.stream)).toEqual([true]);
    expect({
      leakingLogLines: logs.lines.filter(isLeak),
      leakingSseLines: res.body.split("\n").filter(isLeak),
      clientMessages: sseErrorMessages(res.body),
      streamErrorLogLines: logs.lines.filter((l) => l.startsWith(streamErrorLine)),
    }).toEqual({
      leakingLogLines: [],
      leakingSseLines: [],
      // RNX-190 (D199): the typed text (the 400 body does not name the model, so it is "unavailable").
      clientMessages: [`${status === 401 ? "Provider rejected the credentials" : "Provider unavailable"} (${status}). No credits were charged.`],
      streamErrorLogLines: [`${streamErrorLine}: Provider error (status ${status})`],
    });
  });

  // RNX-190 (D197, D208): a provider 401 body that echoes the key's last characters and its SHA-256 (RX-174) reaches
  // no line the process prints (Nest's Logger is not mocked) and nothing the client receives, on the non-stream call.
  it("RNX-190 AC1: stream false, the provider answers 401 with a planted key suffix and SHA-256 → neither is in any output line or in the response", async () => {
    primary.respond((_r, res) => sendJson(res, 401, plantedProviderSecret.body));
    const user = await createUser(prisma);
    await createApiKey(prisma, user.id, { apiKey: API_KEY });
    await fundPaidWallet(prisma, user.id, 1);
    const output = captureOutput();

    const res = await app.inject({
      method: "POST",
      url: "/chat/completions",
      headers: { authorization: `Bearer ${API_KEY}` },
      payload: { model: "test-model", messages: [{ role: "user", content: "Hi" }] },
    });

    expect({
      status: res.statusCode,
      providerCalls: primary.requests.length,
      leakingOutputLines: output.lines.filter(plantedProviderSecret.isFoundIn),
      leaksInResponse: plantedProviderSecret.isFoundIn(res.body),
    }).toEqual({ status: 500, providerCalls: 1, leakingOutputLines: [], leaksInResponse: false });
  });

  // RNX-190 (D199): the client gets the typed error's fixed text; the HTTP code stays (500 here, an SSE error event on
  // a stream) and the process keeps answering.
  const typedCases: Array<[string, (res: ServerResponse) => void, string]> = [
    ["401", (res) => sendJson(res, 401, { error: { message: "invalid key" } }), "Provider rejected the credentials (401)"],
    ["404 naming the model", (res) => sendJson(res, 404, { error: { message: "The model test-model does not exist" } }), "Model not found at the provider (404)"],
    ["503", (res) => sendJson(res, 503, { error: { message: "overloaded" } }), "Provider unavailable (503)"],
  ];

  it.each(typedCases)("RNX-190 AC2: stream true, the provider answers %s → an SSE error event with the typed fixed text; health answers", async (_name, answer, text) => {
    primary.respond((_r, res) => answer(res));
    const user = await createUser(prisma);
    await createApiKey(prisma, user.id, { apiKey: API_KEY });
    await fundPaidWallet(prisma, user.id, 1);

    const res = await app.inject({
      method: "POST",
      url: "/chat/completions",
      headers: { authorization: `Bearer ${API_KEY}` },
      payload: { model: "test-model", messages: [{ role: "user", content: "Hi" }], stream: true },
    });

    expect(sseErrorMessages(res.body)).toEqual([`${text}. No credits were charged.`]);
    expect((await app.inject({ method: "GET", url: "/health" })).statusCode).toBe(200);
  });

  it("RNX-190 AC2: stream true, the connect times out → an SSE error event with the timeout's fixed text; health answers", async () => {
    jest.spyOn(AbortSignal, "any").mockImplementation(() => AbortSignal.abort(new DOMException("timed out", "TimeoutError")));
    const user = await createUser(prisma);
    await createApiKey(prisma, user.id, { apiKey: API_KEY });
    await fundPaidWallet(prisma, user.id, 1);

    const res = await app.inject({
      method: "POST",
      url: "/chat/completions",
      headers: { authorization: `Bearer ${API_KEY}` },
      payload: { model: "test-model", messages: [{ role: "user", content: "Hi" }], stream: true },
    });

    expect(sseErrorMessages(res.body)).toEqual(["Provider timed out. No credits were charged."]);
    expect((await app.inject({ method: "GET", url: "/health" })).statusCode).toBe(200);
  });

  // A 503 is retried 6 times with a real back-off of 44 s on this route; its typed text is checked on the adapter.
  it.each(typedCases.slice(0, 2))("RNX-190 AC2: stream false, the provider answers %s → HTTP 500 with the typed fixed text", async (_name, answer, text) => {
    primary.respond((_r, res) => answer(res));
    const user = await createUser(prisma);
    await createApiKey(prisma, user.id, { apiKey: API_KEY });
    await fundPaidWallet(prisma, user.id, 1);

    const res = await app.inject({
      method: "POST",
      url: "/chat/completions",
      headers: { authorization: `Bearer ${API_KEY}` },
      payload: { model: "test-model", messages: [{ role: "user", content: "Hi" }] },
    });

    expect([res.statusCode, res.json().message]).toEqual([500, `${text}. No credits were charged.`]);
  });
});
