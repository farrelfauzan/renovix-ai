import { Logger } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { TestingModule } from "@nestjs/testing";
import { NestFastifyApplication } from "@nestjs/platform-fastify";
import axios from "axios";
import { randomUUID } from "node:crypto";
import { request as httpRequest } from "node:http";
import { AddressInfo } from "node:net";
import { PortalController } from "./portal.controller";
import { EntitlementService } from "../../offers/service/entitlement.service";
import { extractProviderError } from "../utils/extract-provider-error";
import { PortalTierService } from "../service/portal-tier.service";
import { PrismaService } from "../../prisma/prisma.service";
import { ModelRegistryService } from "../../config/model-registry.service";
import { MODEL_UNAVAILABLE_MESSAGE } from "../../config/errors/model-unavailable.exception";
import { ProvidersModule } from "../../providers/providers.module";
import { ProviderRouter } from "../../providers/provider-router";
import { OpenRouterAdapter } from "../../providers/openrouter.adapter";
import { HealthController } from "../../health/controller/health.controller";
import { CreditService } from "../../billing/service/credit.service";
import { UsageService } from "../../usage/service/usage.service";
import { PromptTuningService } from "../../chat/service/prompt-tuning.service";
import { ConversationService } from "../../chat/service/conversation.service";
import { KnowledgeService } from "../../knowledge/service/knowledge.service";
import { GuardrailService } from "../../guardrail/service/guardrail.service";
import { DocumentService } from "../../document/service/document.service";
import { createFastifyApp, createTestModule } from "../../../../test/test-module";
import { resetDatabase } from "../../../../test/test-database";
import { createUser } from "../../../../test/factories";
import { fundPaidWallet } from "../../../../test/credit-funding";
import { assertCreditLedgerInvariants } from "../../../../test/credit-ledger-invariants";
import {
  blockOutbound,
  OutboundBlocker,
  pointLlmAtStubs,
  sendJson,
  sendSse,
  startStubHttpServer,
  StubHttpServer,
} from "../../../../test/llm-stub";
import { createResolvableModel, testConnection } from "../../../../test/provider-model";
import { captureLogs } from "../../../../test/sse-client";
import { asSessionUser } from "../../../../test/as-session-user";

// RX-169: a provider that answers a streamed portal chat with an error status
// must give the client an SSE error event and leave the process running. The
// real OpenRouterAdapter talks to local stub servers (blockOutbound keeps every
// other host off the network). Jest fails the running test on any uncaught
// exception or unhandled rejection, so a green test also means none was raised.
jest.mock("../../usage/service/usage.service", () => ({ UsageService: class {} }));
jest.mock("../../chat/service/prompt-tuning.service", () => ({ PromptTuningService: class {} }));
jest.mock("../../chat/service/conversation.service", () => ({ ConversationService: class {} }));
jest.mock("../../knowledge/service/knowledge.service", () => ({ KnowledgeService: class {} }));
jest.mock("../../guardrail/service/guardrail.service", () => ({ GuardrailService: class {} }));
jest.mock("../../document/service/document.service", () => ({ DocumentService: class {} }));

const PRIMARY_KEY = "rx169-marker-key-not-real-primary";
const FALLBACK_KEY = "rx169-marker-key-not-real-fallback";
process.env.IP_HASH_SECRET = "rx169-test-secret";

describe("RX-169: provider error on a streamed portal chat (Fastify, test database)", () => {
  let primary: StubHttpServer;
  let fallback: StubHttpServer;
  let blocker: OutboundBlocker;
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let app: NestFastifyApplication;
  let restoreEnv: () => void;

  beforeAll(async () => {
    [primary, fallback] = await Promise.all([startStubHttpServer(), startStubHttpServer()]);
    restoreEnv = pointLlmAtStubs({ primary, apiKey: PRIMARY_KEY, fallback, fallbackApiKey: FALLBACK_KEY });
    ({ moduleRef, prisma } = await createTestModule({
      imports: [ConfigModule.forRoot({ isGlobal: true, ignoreEnvFile: true }), ProvidersModule],
      controllers: [PortalController, HealthController],
      providers: [
        EntitlementService,
        PortalTierService,
        CreditService,
        ModelRegistryService,
        {
          provide: PromptTuningService,
          useValue: {
            applyTuning: async (messages: unknown) => ({ tunedMessages: messages, matchedTemplate: null }),
          },
        },
        { provide: GuardrailService, useValue: { checkInput: async () => ({ blocked: false }) } },
        { provide: UsageService, useValue: {} },
        { provide: ConversationService, useValue: {} },
        { provide: KnowledgeService, useValue: { listKnowledgeBases: async () => [] } },
        { provide: DocumentService, useValue: {} },
      ],
    }));
    app = await createFastifyApp(moduleRef);
  });

  beforeEach(async () => {
    blocker = blockOutbound();
    primary.requests.length = 0;
    fallback.requests.length = 0;
    await resetDatabase(prisma);
    await createResolvableModel(prisma, {
      slug: "standard-cheap",
      modelName: "standard-cheap",
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
    await Promise.all([primary?.close(), fallback?.close()]);
    restoreEnv?.();
  });

  const freeChat = () =>
    app.inject({
      method: "POST",
      url: "/chat/portal/completions",
      headers: { "x-portal-session": "11111111-1111-4111-8111-111111111111" },
      payload: { messages: [{ role: "user", content: "Hi" }] },
    });

  /** A paid chat by a user funded with 5 credits through the ledger (RX-22); returns the response. */
  const paidChat = async () => {
    const user = await createUser(prisma);
    await fundPaidWallet(prisma, user.id, 5);
    const session = asSessionUser(user);
    return app.inject({
      method: "POST",
      url: "/chat/portal/completions",
      headers: { "x-portal-session": "22222222-2222-4222-8222-222222222222", ...session },
      payload: { model: "standard-cheap", messages: [{ role: "user", content: "Hi" }] },
    });
  };

  /** The `error.message` of the SSE error event in a response body (undefined when there is none). */
  const sseErrorMessage = (body: string): string | undefined =>
    body
      .split("\n\n")
      .map((event) => event.replace(/^data: /, ""))
      .filter((data) => data.startsWith('{"error"'))
      .map((data) => JSON.parse(data).error.message as string)[0];

  /**
   * RX-22 (was: a refundReservation spy): the paid call has one provider_error usage entry of amount 0, its hold is
   * released, the paid wallet is back to 5 credits with nothing held, and I1/I2 hold.
   */
  const expectProviderErrorReleased = async () => {
    const usage = await prisma.creditLedgerEntry.findMany({ where: { type: "usage" } });
    expect(usage.map((e) => [e.outcome, e.amount.toFixed(6)])).toEqual([["provider_error", "0.000000"]]);
    expect((await prisma.creditReservation.findMany()).map((r) => r.status)).toEqual(["released"]);
    const [account] = await prisma.creditAccount.findMany();
    expect([account.balance.toFixed(6), account.held.toFixed(6)]).toEqual(["5.000000", "0.000000"]);
    await assertCreditLedgerInvariants(prisma);
  };

  const expectHealthy = async () => {
    const health = await app.inject({ method: "GET", url: "/health" });
    expect(health.statusCode).toBe(200);
    expect(health.json()).toEqual({ status: "ok", database: "connected" });
  };

  it("AC1: free tier, provider answers 400 → SSE error event naming 400, response ends, health answers", async () => {
    primary.respond((_r, res) => sendJson(res, 400, { error: { message: "unknown model" } }));

    const res = await freeChat();

    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toBe("text/event-stream");
    expect(sseErrorMessage(res.body)).toMatch(/400/);
    expect(primary.requests).toHaveLength(1);
    expect(fallback.requests).toHaveLength(0);
    await expectHealthy();
  });

  // RX-178 (D199-4): the env fallback (LLM_FALLBACK_*, still set by pointLlmAtStubs here) is never tried any more.
  it.each([502, 503])("AC2: the provider answers %i → SSE error event naming it, the env fallback receives 0, health answers", async (status) => {
    primary.respond((_r, res) => sendJson(res, status, { error: { message: "provider down" } }));
    fallback.respond((_r, res) => sendSse(res, ['{"choices":[{"delta":{"content":"from fallback"}}]}']));

    const res = await freeChat();

    expect(sseErrorMessage(res.body)).toMatch(new RegExp(String(status)));
    expect(primary.requests).toHaveLength(1);
    expect(fallback.requests).toHaveLength(0);
    await expectHealthy();
  });

  // RNX-208 (D197, D208; replaces the RX-169 AC3 excerpt): a provider 401 body can echo the key's last characters and
  // its hash (RX-174). The body (a planted marker and a fake key suffix) reaches no log line and no SSE line; the
  // client and the log get only the fixed texts (toProviderErrorText), and a 400 still says "Provider rejected request".
  describe("RNX-208: the provider's error body reaches no log line and no SSE line (real adapter, local stub)", () => {
    const marker = `LEAK-MARKER-${randomUUID()}`;
    const plantedBody = { error: { message: `Incorrect API key provided: ${marker} ...sk-or-v1-FAKE1234`, code: 401 } };
    const isLeak = (text: string) => text.includes(marker) || text.includes("FAKE1234") || text.includes("rx169-marker-key");

    it.each([
      ["free", 401, "Provider request failed (401)"],
      ["free", 400, "Provider rejected request (HTTP 400)"],
      ["paid", 401, "Provider request failed (401). No credits were charged."],
      ["paid", 400, "Provider rejected request (HTTP 400). No credits were charged."],
    ])("%s tier, the provider answers %i with the marker in its body → the client gets %j", async (tier, status, expectedMessage) => {
      const logs = captureLogs();
      primary.respond((_r, res) => sendJson(res, status, plantedBody));

      const res = tier === "free" ? await freeChat() : await paidChat();

      const streamErrorLine = `OpenRouter stream error (${new URL(primary.baseUrl).host}, ${status})`;
      expect(primary.requests).toHaveLength(1);
      expect({
        leakingLogLines: logs.lines.filter(isLeak),
        leakingSseLines: res.body.split("\n").filter(isLeak),
        clientMessage: sseErrorMessage(res.body),
        streamErrorLogLines: logs.lines.filter((l) => l.startsWith(streamErrorLine)),
      }).toEqual({
        leakingLogLines: [],
        leakingSseLines: [],
        clientMessage: expectedMessage,
        streamErrorLogLines: [`${streamErrorLine}: Provider error (status ${status})`],
      });
    });
  });

  it("AC5: paid tier, provider answers 400 → SSE error event naming 400 with the no-charge note, hold released, health answers", async () => {
    primary.respond((_r, res) => sendJson(res, 400, { error: { message: "unknown model" } }));

    const res = await paidChat();

    expect(res.statusCode).toBe(200);
    expect(sseErrorMessage(res.body)).toMatch(/400.*No credits were charged\.$/);
    await expectProviderErrorReleased();
    await expectHealthy();
  });

  describe("RX-161 AC-e: an empty answer cut off by max_tokens (paid tier)", () => {
    it("negative: an SSE error event instead of a reply; nothing empty streamed or stored; nothing charged", async () => {
      const lines: string[] = [];
      jest.spyOn(Logger.prototype, "error").mockImplementation((...args: unknown[]) => void lines.push(String(args[0])));
      const conversation = Object.assign(moduleRef.get(ConversationService), {
        getOrCreateConversation: jest.fn(async () => "conversation-id"),
        saveMessages: jest.fn(async () => undefined),
      });
      Object.assign(moduleRef.get(UsageService), { logUsage: jest.fn(async () => undefined) });
      primary.respond((_r, res) => {
        res.writeHead(200, { "Content-Type": "text/event-stream" });
        res.write('data: {"choices":[{"delta":{"role":"assistant","content":""}}]}\n\n');
        res.write('data: {"choices":[{"delta":{},"finish_reason":"length"}]}\n\n');
        res.end("data: [DONE]\n\n");
      });

      const res = await paidChat();

      expect(sseErrorMessage(res.body)).toMatch(/No credits were charged\.$/);
      expect(res.body).not.toContain('"choices"');
      expect(res.body).not.toContain("data: [DONE]");
      expect(conversation.saveMessages).not.toHaveBeenCalled();
      await expectProviderErrorReleased();
      expect(lines.some((l) => /Model standard-cheap returned an empty answer: max_tokens \(\d+\)/.test(l))).toBe(true);
      await expectHealthy();
    });
  });

  describe("RX-161 AC-f: the client disconnects mid-stream (free tier, real socket)", () => {
    it("the upstream request to the provider is aborted; the API keeps answering", async () => {
      const upstreamClosed = new Promise<void>((closed) =>
        primary.respond((_r, res) => {
          res.writeHead(200, { "Content-Type": "text/event-stream" });
          res.write('data: {"choices":[{"delta":{"content":"Hel"}}]}\n\n');
          res.on("close", () => closed());
        }),
      );
      if (!app.getHttpServer().listening) await app.listen(0, "127.0.0.1");
      const { port } = app.getHttpServer().address() as AddressInfo;
      const client = httpRequest({
        host: "127.0.0.1",
        port,
        method: "POST",
        path: "/chat/portal/completions",
        headers: { "content-type": "application/json", "x-portal-session": "33333333-3333-4333-8333-333333333333" },
      });
      client.on("error", () => undefined); // destroyed below on purpose
      client.end(JSON.stringify({ messages: [{ role: "user", content: "Hi" }] }));
      const response = await new Promise<import("node:http").IncomingMessage>((r) => client.on("response", r));
      await new Promise<void>((received) =>
        response.on("data", (chunk: Buffer) => chunk.toString().includes("Hel") && received()),
      );

      client.destroy();

      await upstreamClosed;
      expect(primary.requests).toHaveLength(1);
      await expectHealthy();
    }, 10000);
  });

  describe("RX-178: the paid stream resolves the model to its provider record before anything is reserved", () => {
    it.each([
      ["an inactive provider", { status: "inactive" as const }],
      ["a soft-deleted provider", { deletedAt: new Date() }],
    ])("%s → 400 with the fixed text before the stream opens; no reservation, no provider call", async (_name, change) => {
      await prisma.provider.updateMany({ data: change });
      await moduleRef.get(ModelRegistryService).refresh();

      const res = await paidChat();

      expect(res.statusCode).toBe(400);
      expect(res.json().message).toBe(MODEL_UNAVAILABLE_MESSAGE);
      expect(primary.requests).toHaveLength(0);
      expect(fallback.requests).toHaveLength(0);
      expect(await prisma.creditReservation.count()).toBe(0);
      await assertCreditLedgerInvariants(prisma);
    });
  });

  describe("RX-22: the paid stream on the credit ledger", () => {
    const paidAccount = async () => {
      const [account] = await prisma.creditAccount.findMany();
      return [account.balance.toFixed(6), account.held.toFixed(6)];
    };

    const chatAs = (user: { id: string; email: string }, session: string) =>
      app.inject({
        method: "POST",
        url: "/chat/portal/completions",
        headers: {
          "x-portal-session": session,
          ...asSessionUser(user),
        },
        payload: { model: "standard-cheap", messages: [{ role: "user", content: "Hi" }] },
      });

    it("AC: the portal gate follows the ledger: a signed-in user without ledger credits → the free path (no reservation)", async () => {
      const lines: string[] = [];
      jest.spyOn(Logger.prototype, "error").mockImplementation((...args: unknown[]) => void lines.push(String(args[0])));
      primary.respond((_r, res) => sendJson(res, 400, { error: { message: "unknown model" } }));
      const user = await createUser(prisma);

      const res = await chatAs(user, "55555555-5555-4555-8555-555555555555");

      expect(sseErrorMessage(res.body)).toMatch(/400/);
      expect(sseErrorMessage(res.body)).not.toMatch(/No credits were charged/); // the free path's message
      expect(await prisma.creditReservation.count()).toBe(0);
      expect(await prisma.anonymousUsageCounter.count()).toBeGreaterThan(0);
    });

    it("AC: 402 CREDITS_EXHAUSTED before the stream opens when the paid wallet cannot cover the estimate; nothing written, no provider call", async () => {
      const user = await createUser(prisma);
      await fundPaidWallet(prisma, user.id, "0.000001");

      const res = await chatAs(user, "66666666-6666-4666-8666-666666666666");

      expect(res.statusCode).toBe(402);
      expect(res.json()).toMatchObject({ code: "CREDITS_EXHAUSTED" });
      expect(primary.requests).toHaveLength(0);
      expect(await prisma.creditReservation.count()).toBe(0);
      expect(await paidAccount()).toEqual(["0.000001", "0.000000"]);
    });

    it("D197/D208: a mid-stream error chunk is a provider error reported by fixed texts: its message (a marker) is in no SSE line and no log line", async () => {
      const lines: string[] = [];
      const capture = (...args: unknown[]) =>
        void lines.push(args.map((a) => (typeof a === "string" ? a : a instanceof Error ? `${a.message} ${a.stack}` : JSON.stringify(a))).join(" "));
      for (const m of ["log", "warn", "error", "debug", "verbose", "fatal"] as const) {
        jest.spyOn(Logger.prototype, m).mockImplementation(capture);
      }
      for (const m of ["log", "warn", "error", "info", "debug"] as const) jest.spyOn(console, m).mockImplementation(capture);
      primary.respond((_r, res) => {
        res.writeHead(200, { "Content-Type": "text/event-stream" });
        res.write('data: {"choices":[{"delta":{"content":"Hel"}}]}\n\n');
        res.write(
          'data: {"id":"gen-1","error":{"code":502,"message":"RX22-PROVIDER-MARKER disconnected","metadata":{"raw":"RX22-PROVIDER-MARKER"}},"choices":[{"index":0,"delta":{"content":""},"finish_reason":"error"}]}\n\n',
        );
        res.end();
      });

      const res = await paidChat();

      expect(sseErrorMessage(res.body)).toBe("Provider request failed (502). No credits were charged.");
      expect(res.body).not.toContain("RX22-PROVIDER-MARKER");
      expect(res.body).not.toContain('"finish_reason":"error"');
      expect(res.body).not.toContain("data: [DONE]");
      expect(lines.some((l) => l.includes("Provider error (status 502)"))).toBe(true);
      expect(lines.filter((l) => l.includes("RX22-PROVIDER-MARKER"))).toEqual([]);
      await expectProviderErrorReleased();
      await expectHealthy();
    });

    it("the usage chunk before [DONE] is charged: cached input from prompt_tokens_details, one completed entry, settled", async () => {
      Object.assign(moduleRef.get(UsageService), { logUsage: jest.fn(async () => undefined) });
      Object.assign(moduleRef.get(ConversationService), {
        getOrCreateConversation: jest.fn(async () => "conversation-id"),
        saveMessages: jest.fn(async () => undefined),
      });
      primary.respond((_r, res) => {
        res.writeHead(200, { "Content-Type": "text/event-stream" });
        res.write('data: {"choices":[{"delta":{"content":"Hello"}}]}\n\n');
        res.write('data: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\n');
        res.write(
          'data: {"choices":[{"delta":{"content":""},"finish_reason":"stop"}],"usage":{"prompt_tokens":100,"completion_tokens":10,"total_tokens":110,"prompt_tokens_details":{"cached_tokens":60}}}\n\n',
        );
        res.end("data: [DONE]\n\n");
      });

      const res = await paidChat();

      expect(res.body).toContain("data: [DONE]");
      const usage = await prisma.creditLedgerEntry.findMany({ where: { type: "usage" } });
      expect(usage.map((e) => [e.outcome, e.tokensNew, e.tokensCached, e.tokensOut, e.amount.toFixed(6)])).toEqual([
        ["completed", 40, 60, 10, "-0.000110"],
      ]);
      // Hold: I = 4 ("user") + 2 ("Hi") + 4 = 10 tokens, M = 4,096 (portal default) at 1/1/1 = 0.004106
      expect((await prisma.creditReservation.findMany()).map((r) => [r.amountHeld.toFixed(6), r.status, r.consumed.toFixed(6)])).toEqual([
        ["0.004106", "settled", "0.000110"],
      ]);
      expect(await paidAccount()).toEqual(["4.999890", "0.000000"]);
      await assertCreditLedgerInvariants(prisma);
    });

    /**
     * A paid chat with `userMessage` whose client goes away once the provider streamed `streamedText` (real socket, no
     * usage chunk); returns once the reservation is closed.
     */
    const cancelMidStream = async (userMessage: string, streamedText: string) => {
      Object.assign(moduleRef.get(UsageService), { logUsage: jest.fn(async () => undefined) });
      Object.assign(moduleRef.get(ConversationService), {
        getOrCreateConversation: jest.fn(async () => "conversation-id"),
        saveMessages: jest.fn(async () => undefined),
      });
      const upstreamClosed = new Promise<void>((closed) =>
        primary.respond((_r, res) => {
          res.writeHead(200, { "Content-Type": "text/event-stream" });
          res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: streamedText } }] })}\n\n`);
          res.on("close", () => closed());
        }),
      );
      const user = await createUser(prisma);
      await fundPaidWallet(prisma, user.id, 5);
      const session = asSessionUser(user);
      if (!app.getHttpServer().listening) await app.listen(0, "127.0.0.1");
      const { port } = app.getHttpServer().address() as AddressInfo;
      const client = httpRequest({
        host: "127.0.0.1",
        port,
        method: "POST",
        path: "/chat/portal/completions",
        headers: {
          "content-type": "application/json",
          "x-portal-session": "44444444-4444-4444-8444-444444444444",
          ...session,
        },
      });
      client.on("error", () => undefined); // destroyed below on purpose
      client.end(JSON.stringify({ model: "standard-cheap", messages: [{ role: "user", content: userMessage }] }));
      const response = await new Promise<import("node:http").IncomingMessage>((r) => client.on("response", r));
      await new Promise<void>((received) =>
        response.on("data", (chunk: Buffer) => chunk.toString().includes(streamedText) && received()),
      );
      expect(await paidAccount()).not.toEqual(["5.000000", "0.000000"]); // the hold is on while it streams
      client.destroy();
      await upstreamClosed;
      for (let i = 0; i < 100 && (await prisma.creditReservation.count({ where: { status: "open" } })) > 0; i++) {
        await new Promise((r) => setTimeout(r, 20));
      }
    };

    /** The one usage entry (outcome, tokens new/cached/out, amount) and the reservation (held, status). */
    const callRecord = async () => {
      const [entry] = await prisma.creditLedgerEntry.findMany({ where: { type: "usage" } });
      const [reservation] = await prisma.creditReservation.findMany();
      return {
        entry: [entry.outcome, entry.tokensNew, entry.tokensCached, entry.tokensOut, entry.amount.toFixed(6)],
        reservation: [reservation.amountHeld.toFixed(6), reservation.status],
      };
    };

    it("AC: a killed request (client gone mid-stream, no usage chunk) is charged ceil(chars / 4) as client_cancel and settled, held back to 0", async () => {
      await cancelMidStream("Hi", "Hello");

      // D205: prompt sent "user" + "Hi" = 6 characters -> 2; output "Hello" = 5 characters -> 2; 4 micro-credits.
      // The hold is the byte estimate: 4 + 2 + 4 per message = 10, + M 4,096 = 0.004106.
      expect(await callRecord()).toEqual({
        entry: ["client_cancel", 2, 0, 2, "-0.000004"],
        reservation: ["0.004106", "settled"],
      });
      expect(await paidAccount()).toEqual(["4.999996", "0.000000"]);
      await assertCreditLedgerInvariants(prisma);
      await expectHealthy();
    }, 10000);

    it("D205: the hold estimate counts UTF-8 bytes while the cancel charge counts code points / 4", async () => {
      await cancelMidStream("你好你好", "你好");

      // Hold: "user" 4 + "你好你好" 12 bytes + 4 = 20, + 4,096 = 4,116 -> 0.004116 (code points would give 0.004108).
      // Charge: "user你好你好" = 8 code points -> 2, "你好" = 2 -> 1 (bytes would give 16 and 6): 3 micro-credits.
      expect(await callRecord()).toEqual({
        entry: ["client_cancel", 2, 0, 1, "-0.000003"],
        reservation: ["0.004116", "settled"],
      });
      expect(await paidAccount()).toEqual(["4.999997", "0.000000"]);
      await assertCreditLedgerInvariants(prisma);
    }, 10000);

    it("D205: a stream that ends normally without a usage chunk is charged ceil(chars / 4), outcome completed", async () => {
      Object.assign(moduleRef.get(UsageService), { logUsage: jest.fn(async () => undefined) });
      Object.assign(moduleRef.get(ConversationService), {
        getOrCreateConversation: jest.fn(async () => "conversation-id"),
        saveMessages: jest.fn(async () => undefined),
      });
      primary.respond((_r, res) => sendSse(res, ['{"choices":[{"delta":{"content":"Hello there"}}]}', '{"choices":[{"delta":{},"finish_reason":"stop"}]}']));

      const res = await paidChat();

      // "userHi" = 6 characters -> 2; "Hello there" = 11 characters -> 3; 5 micro-credits.
      expect(res.body).toContain("data: [DONE]");
      expect(await callRecord()).toEqual({
        entry: ["completed", 2, 0, 3, "-0.000005"],
        reservation: ["0.004106", "settled"],
      });
      expect(await paidAccount()).toEqual(["4.999995", "0.000000"]);
      await assertCreditLedgerInvariants(prisma);
    });
  });

  describe("RX-22 review NIT 3, 4 and 6: what a client that went away is charged", () => {
    /**
     * A paid chat whose provider stream is `stream` (ProviderRouter.chatStream replaced; it gets the request's abort
     * signal). The client waits for an SSE line containing `waitFor`, then goes away; returns once the reservation
     * is closed.
     */
    const goAwayDuring = async (
      stream: (signal: AbortSignal) => AsyncGenerator<string, void, unknown>,
      waitFor: string,
    ) => {
      Object.assign(moduleRef.get(UsageService), { logUsage: jest.fn(async () => undefined) });
      Object.assign(moduleRef.get(ConversationService), {
        getOrCreateConversation: jest.fn(async () => "conversation-id"),
        saveMessages: jest.fn(async () => undefined),
      });
      jest
        .spyOn(moduleRef.get(ProviderRouter), "chatStream")
        .mockImplementation((params) => stream(params.signal!));
      const user = await createUser(prisma);
      await fundPaidWallet(prisma, user.id, 5);
      const session = asSessionUser(user);
      if (!app.getHttpServer().listening) await app.listen(0, "127.0.0.1");
      const { port } = app.getHttpServer().address() as AddressInfo;
      const client = httpRequest({
        host: "127.0.0.1",
        port,
        method: "POST",
        path: "/chat/portal/completions",
        headers: { "content-type": "application/json", "x-portal-session": SESSION_NIT, ...session },
      });
      client.on("error", () => undefined); // destroyed below on purpose
      client.end(JSON.stringify({ model: "standard-cheap", messages: [{ role: "user", content: "Hi" }] }));
      const response = await new Promise<import("node:http").IncomingMessage>((r) => client.on("response", r));
      await new Promise<void>((received) => response.on("data", (chunk: Buffer) => chunk.toString().includes(waitFor) && received()));
      client.destroy();
      for (let i = 0; i < 100 && (await prisma.creditReservation.count({ where: { status: "open" } })) > 0; i++) {
        await new Promise((r) => setTimeout(r, 20));
      }
      const [entry] = await prisma.creditLedgerEntry.findMany({ where: { type: "usage" } });
      const [reservation] = await prisma.creditReservation.findMany();
      const [account] = await prisma.creditAccount.findMany();
      await assertCreditLedgerInvariants(prisma);
      return {
        entry: [entry.outcome, entry.tokensNew, entry.tokensCached, entry.tokensOut, entry.amount.toFixed(6), entry.uncharged.toFixed(6)],
        reservation: reservation.status,
        account: [account.balance.toFixed(6), account.held.toFixed(6)],
      };
    };
    const SESSION_NIT = "88888888-8888-4888-8888-888888888888";
    const aborted = (signal: AbortSignal) => new Promise<void>((resolve) => signal.addEventListener("abort", () => resolve(), { once: true }));

    it("NIT 3: the client goes away before the stream opened (during a Retry-After wait or the connect): provider_error, charged 0, released", async () => {
      const actual = await goAwayDuring(async function* (signal) {
        await aborted(signal);
        throw signal.reason; // as retryOnceAfter and an aborted fetch reject
      }, '"generating"');

      expect(actual).toEqual({
        entry: ["provider_error", 0, 0, 0, "0.000000", "0.000000"],
        reservation: "released",
        account: ["5.000000", "0.000000"],
      });
    }, 10000);

    it("NIT 4: a provider error that arrives after the client went away is a provider_error, not a client_cancel", async () => {
      const actual = await goAwayDuring(async function* (signal) {
        yield JSON.stringify({ choices: [{ delta: { content: "Hello" } }] });
        await aborted(signal);
        yield JSON.stringify({ error: { code: 502, message: "late" }, choices: [{ index: 0, delta: { content: "" }, finish_reason: "error" }] });
      }, "Hello");

      expect(actual).toEqual({
        entry: ["provider_error", 0, 0, 0, "0.000000", "0.000000"],
        reservation: "released",
        account: ["5.000000", "0.000000"],
      });
    }, 10000);

    it("NIT 6: the client goes away after the usage chunk arrived: the reported tokens are charged as client_cancel", async () => {
      const actual = await goAwayDuring(async function* (signal) {
        yield JSON.stringify({ choices: [{ delta: { content: "Hello" } }] });
        yield JSON.stringify({
          choices: [{ delta: { content: "" }, finish_reason: "stop" }],
          usage: { prompt_tokens: 30, completion_tokens: 7, total_tokens: 37, prompt_tokens_details: { cached_tokens: 10 } },
        });
        await aborted(signal);
      }, '"usage"');

      expect(actual).toEqual({
        entry: ["client_cancel", 20, 10, 7, "-0.000037", "0.000000"],
        reservation: "settled",
        account: ["4.999963", "0.000000"],
      });
    }, 10000);
  });

  describe("AC4: the error the adapter rethrows can be read by extractProviderError", () => {
    const extract = (error: unknown) => extractProviderError(error);

    it("the error exactly as the adapter rethrew it before RX-169 (AxiosError, response.data a drained stream) does not throw", async () => {
      primary.respond((_r, res) => sendJson(res, 400, { error: { message: "unknown model" } }));
      const thrown = await axios
        .post(`${primary.baseUrl}/chat/completions`, {}, { responseType: "stream" })
        .catch((err) => err);
      for await (const _chunk of thrown.response.data) {
        // drained, as OpenRouterAdapter.openStream did before rethrowing
      }

      const actual = extract(thrown);

      expect(axios.isAxiosError(thrown)).toBe(true);
      expect(actual.status).toBe(400);
      expect(actual.clientMessage).toMatch(/400/);
    });

    // RNX-190: the error no longer carries the body text, only the status and its kind.
    it("the adapter's stream error carries the status and its kind, not the body text; extractProviderError uses only the status (RNX-208)", async () => {
      primary.respond((_r, res) => sendJson(res, 429, { error: { message: "RX169 slow down" } }));
      const adapter = moduleRef.get(OpenRouterAdapter);
      const thrown = await (async () => {
        for await (const _payload of adapter.chatStream({ model: "m", connection: testConnection({ baseUrl: primary.baseUrl }), messages: [] })) {
          // no payload is expected
        }
      })().catch((err) => err);

      const actual = extract(thrown);

      expect(thrown).toMatchObject({ status: 429, kind: "unavailable" });
      expect(thrown).not.toHaveProperty("bodyText");
      expect(actual).toMatchObject({ status: 429 });
      expect(actual.clientMessage).toBe("Provider request failed (429)");
    });
  });
});
