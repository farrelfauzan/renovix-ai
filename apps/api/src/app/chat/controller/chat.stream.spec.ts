import { ConfigModule } from "@nestjs/config";
import { TestingModule } from "@nestjs/testing";
import { NestFastifyApplication } from "@nestjs/platform-fastify";
import { IncomingMessage, request as httpRequest } from "node:http";
import { AddressInfo } from "node:net";
import { ChatController } from "./chat.controller";
import { ChatService } from "../service/chat.service";
import { ConversationService } from "../service/conversation.service";
import { CreditService } from "../../billing/service/credit.service";
import { countCharTokens } from "../../billing/utils/count-char-tokens";
import { promptText } from "../../billing/utils/prompt-text";
import { UsageService } from "../../usage/service/usage.service";
import { DocumentService } from "../../document/service/document.service";
import { EmbeddingService } from "../../knowledge/service/embedding.service";
import { SystemKnowledgeService } from "../../knowledge/service/system-knowledge.service";
import { ModelRegistryService } from "../../config/model-registry.service";
import { ProvidersModule } from "../../providers/providers.module";
import { ProviderRouter } from "../../providers/provider-router";
import type { ChatMessage } from "../../providers/provider.interface";
import { ProviderHttpError } from "../../providers/errors/provider-http-error";
import { PrismaService } from "../../prisma/prisma.service";
import { createFastifyApp, createTestModule } from "../../../../test/test-module";
import { resetDatabase } from "../../../../test/test-database";
import { createUser, createApiKey, testApiKey } from "../../../../test/factories";
import { fundPaidWallet } from "../../../../test/credit-funding";
import { assertCreditLedgerInvariants } from "../../../../test/credit-ledger-invariants";
import { FakeProviderAdapter, withFakeProvider } from "../../../../test/fake-provider";
import { realPromptTuning } from "../../../../test/real-prompt-tuning";
import { createResolvableModel } from "../../../../test/provider-model";
import { captureLogs, sseErrorMessages } from "../../../../test/sse-client";
import { blockOutbound, OutboundBlocker } from "../../../../test/llm-stub";

// RNX-196: POST /chat/completions (API key) streams OpenAI chat.completion.chunk events when `stream` is true, metered
// on the credit ledger as the portal paid stream is (docs/credits.md section 3.1). Real ChatController, ChatService,
// CreditService, model registry and prompt tuning (EmbeddingService.embedSingle spied, answering locally) on the test
// database; the model is the fake provider (RX-8), the system knowledge sync at startup is skipped and every other
// outbound call is blocked. These collaborators load ESM-only packages.
jest.mock("../service/conversation.service", () => ({ ConversationService: class {} }));
jest.mock("../../document/service/document.service", () => ({ DocumentService: class {} }));
jest.mock("../../usage/service/usage.service", () => ({ UsageService: class {} }));

const API_KEY = testApiKey("rnx196-test-key");
const MODEL = "stream-model";
const MARKER = "RNX196-PROVIDER-MARKER";
const MESSAGES = [{ role: "user", content: "Hi" }];

describe("RNX-196: the API-key chat route streams when stream is true (Fastify, test database, fake provider)", () => {
  const fake = new FakeProviderAdapter();
  const tuning = realPromptTuning();
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let app: NestFastifyApplication;
  let embedSingle: jest.SpyInstance;
  let conversation: { getOrCreateConversation: jest.Mock; saveMessages: jest.Mock; generateTitle: jest.Mock };
  let logUsage: jest.Mock;
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
    await prisma.tierRate.create({
      data: { tier: "standard", inputCreditsPerToken: 1, cachedCreditsPerToken: 1, outputCreditsPerToken: 1 },
    });
    await createResolvableModel(prisma, {
      slug: MODEL, modelName: MODEL, inputPrice: 0.000001, outputPrice: 0.000001, maxTokens: 8192,
    });
    await moduleRef.get(ModelRegistryService).refresh();
    embedSingle = jest
      .spyOn(moduleRef.get(EmbeddingService), "embedSingle")
      .mockResolvedValue({ embedding: Array.from({ length: 1024 }, () => 0), tokenCount: 1 });
    conversation = Object.assign(moduleRef.get(ConversationService), {
      getOrCreateConversation: jest.fn(async () => "conversation-id"),
      saveMessages: jest.fn(async () => undefined),
      generateTitle: jest.fn(async () => undefined),
    });
    logUsage = jest.fn(async () => undefined);
    Object.assign(moduleRef.get(UsageService), { logUsage });
  });

  afterEach(() => {
    blocker.restore();
    jest.restoreAllMocks();
  });

  afterAll(async () => {
    await app?.close();
    tuning.restoreEnv();
  });

  /** A user with the route's API key and `credits` on the paid wallet (none when 0). */
  const createApiUser = async (credits: number) => {
    const user = await createUser(prisma);
    await createApiKey(prisma, user.id, { apiKey: API_KEY });
    if (credits > 0) await fundPaidWallet(prisma, user.id, credits);
    return user;
  };

  const complete = (payload: Record<string, unknown>) =>
    app.inject({
      method: "POST",
      url: "/chat/completions",
      headers: { authorization: `Bearer ${API_KEY}` },
      payload: { model: MODEL, messages: MESSAGES, ...payload },
    });

  /** The data of every SSE event of a body, in order. */
  const sseData = (body: string) =>
    body
      .split("\n\n")
      .filter(Boolean)
      .map((event) => event.replace(/^data: /, ""));

  /** The parsed chunks of a streamed body (every event but [DONE]). */
  const chunksOf = (body: string) =>
    sseData(body)
      .filter((data) => data !== "[DONE]")
      .map((data) => JSON.parse(data));

  /** The call's usage entries (outcome, tokens new/cached/out, amount), reservations (status) and the account's held. */
  const callRecord = async () => {
    const entries = await prisma.creditLedgerEntry.findMany({ where: { type: "usage" } });
    const reservations = await prisma.creditReservation.findMany();
    const [account] = await prisma.creditAccount.findMany();
    return {
      entries: entries.map((e) => [e.outcome, e.tokensNew, e.tokensCached, e.tokensOut, e.amount.toFixed(6)]),
      reservations: reservations.map((r) => r.status),
      held: account.held.toFixed(6),
    };
  };

  /**
   * A streamed chat over a real socket whose client goes away once the first chunk ("Hello") arrived. The provider
   * stream (ProviderRouter.chatStream) yields that chunk and then waits for the request's abort signal, and ends
   * quietly as OpenRouterAdapter does when aborted. Returns once no reservation is open, with the upstream signal and
   * the messages the provider received.
   */
  const cancelAfterFirstChunk = async (payload: Record<string, unknown>) => {
    const upstream: { signal?: AbortSignal; messages: ChatMessage[] } = { messages: [] };
    jest.spyOn(moduleRef.get(ProviderRouter), "chatStream").mockImplementation(async function* (params) {
      upstream.signal = params.signal;
      upstream.messages = params.messages;
      yield JSON.stringify({ id: "gen-1", choices: [{ index: 0, delta: { role: "assistant", content: "Hello" }, finish_reason: null }] });
      await new Promise<void>((resolve) => params.signal?.addEventListener("abort", () => resolve(), { once: true }));
    });
    if (!app.getHttpServer().listening) await app.listen(0, "127.0.0.1");
    const { port } = app.getHttpServer().address() as AddressInfo;
    const client = httpRequest({
      host: "127.0.0.1",
      port,
      method: "POST",
      path: "/chat/completions",
      headers: { "content-type": "application/json", authorization: `Bearer ${API_KEY}` },
    });
    client.on("error", () => undefined); // destroyed below on purpose
    client.end(JSON.stringify({ model: MODEL, messages: MESSAGES, stream: true, ...payload }));
    const response = await new Promise<IncomingMessage>((resolve) => client.on("response", resolve));
    await new Promise<void>((received) => {
      response.on("data", (chunk: Buffer) => chunk.toString().includes("Hello") && received());
      response.on("end", () => received());
    });
    client.destroy();
    for (let i = 0; i < 100 && (await prisma.creditReservation.count({ where: { status: "open" } })) > 0; i++) {
      await new Promise((r) => setTimeout(r, 20));
    }
    return upstream;
  };

  describe("AC1, AC2: a funded user streams", () => {
    it("AC1: text/event-stream, chat.completion.chunk events whose deltas join to the answer, then [DONE]; one completed entry, settled, held 0", async () => {
      await createApiUser(1);
      fake.enqueue({ content: "Hello there friend", usage: { prompt_tokens: 30, completion_tokens: 3 } });

      const res = await complete({ stream: true });

      expect(res.statusCode).toBe(200);
      expect(res.headers["content-type"]).toBe("text/event-stream");
      const chunks = chunksOf(res.body);
      const contentChunks = chunks.filter((c) => c.choices[0]?.delta?.content);
      expect(contentChunks.length).toBeGreaterThanOrEqual(2);
      expect(contentChunks.map((c) => c.choices[0].delta.content).join("")).toBe("Hello there friend");
      expect(chunks.every((c) => c.object === "chat.completion.chunk" && c.model === MODEL && c.id === chunks[0].id)).toBe(true);
      expect(chunks[0].choices[0].delta.role).toBe("assistant");
      expect(chunks[chunks.length - 1].choices).toEqual([{ index: 0, delta: {}, finish_reason: "stop" }]);
      expect(sseData(res.body).pop()).toBe("[DONE]");
      expect(res.body).not.toContain('"usage"');
      expect(await callRecord()).toEqual({
        entries: [["completed", 30, 0, 3, "-0.000033"]],
        reservations: ["settled"],
        held: "0.000000",
      });
      expect(logUsage).toHaveBeenCalledTimes(1);
      await assertCreditLedgerInvariants(prisma);
    });

    it("AC2: with include_usage the last chunk before [DONE] carries the ledger entry's tokens (cached as prompt_tokens_details)", async () => {
      await createApiUser(1);
      fake.enqueue({ content: "Hello there", usage: { prompt_tokens: 40, completion_tokens: 6, cached_tokens: 15 } });

      const res = await complete({ stream: true, stream_options: { include_usage: true } });

      const data = sseData(res.body);
      expect(data.pop()).toBe("[DONE]");
      const usageChunk = JSON.parse(data.pop()!);
      const [entry] = await prisma.creditLedgerEntry.findMany({ where: { type: "usage" } });
      expect(usageChunk).toMatchObject({ object: "chat.completion.chunk", choices: [] });
      expect(usageChunk.usage).toEqual({
        prompt_tokens: entry.tokensNew! + entry.tokensCached!,
        completion_tokens: entry.tokensOut,
        total_tokens: entry.tokensNew! + entry.tokensCached! + entry.tokensOut!,
        prompt_tokens_details: { cached_tokens: entry.tokensCached },
      });
      expect(usageChunk.usage).toEqual({ prompt_tokens: 40, completion_tokens: 6, total_tokens: 46, prompt_tokens_details: { cached_tokens: 15 } });
      expect(sseData(res.body).filter((d) => d.includes('"usage"'))).toHaveLength(1);
      await assertCreditLedgerInvariants(prisma);
    });
  });

  it("AC3 (negative): 0 credits + stream:true → HTTP 402 CREDITS_EXHAUSTED JSON, no SSE header, no provider or embedding call", async () => {
    await createApiUser(0);

    const res = await complete({ stream: true });

    expect(res.statusCode).toBe(402);
    expect(res.headers["content-type"]).toMatch(/^application\/json/);
    expect(res.json()).toMatchObject({ code: "CREDITS_EXHAUSTED" });
    expect(embedSingle).not.toHaveBeenCalled();
    expect(fake.requests).toHaveLength(0);
    expect(await prisma.creditReservation.count()).toBe(0);
    await assertCreditLedgerInvariants(prisma);
  });

  it("AC4: the client disconnects after the first chunk (real socket) → upstream aborted, one client_cancel entry charged ceil(chars / 4) (D205), held 0", async () => {
    await createApiUser(1);

    const upstream = await cancelAfterFirstChunk({});

    expect(upstream.signal?.aborted).toBe(true);
    const tokensNew = countCharTokens(promptText(upstream.messages));
    const tokensOut = countCharTokens("Hello");
    expect(await callRecord()).toEqual({
      entries: [["client_cancel", tokensNew, 0, tokensOut, (-(tokensNew + tokensOut) / 1_000_000).toFixed(6)]],
      reservations: ["settled"],
      held: "0.000000",
    });
    await assertCreditLedgerInvariants(prisma);
  }, 10000);

  describe("AC5: a provider error → the fixed text and the end of the stream; charged 0, hold released; the provider's text in no SSE line and no log line", () => {
    it.each([
      {
        // RNX-190 (D199): an HTTP error is typed; it can no longer carry the body or a message of the caller's choosing.
        name: "HTTP error before the first chunk",
        status: 503,
        clientText: "Provider unavailable (503)",
        logText: "Provider error (status 503, unavailable)",
        streamed: "",
        failStream: () =>
          jest.spyOn(moduleRef.get(ProviderRouter), "chatStream").mockImplementation(async function* () {
            yield* [];
            throw new ProviderHttpError({ status: 503, kind: "unavailable" });
          }),
      },
      {
        name: "error chunk as the first chunk",
        status: 429,
        clientText: "Provider request failed (429)",
        logText: "Provider error (status 429)",
        streamed: "",
        failStream: () => fake.enqueue({ error: { code: 429, message: `${MARKER} rate limited` } }),
      },
      {
        name: "error chunk mid-stream",
        status: 502,
        clientText: "Provider request failed (502)",
        logText: "Provider error (status 502)",
        streamed: "Partial answer ",
        failStream: () => fake.enqueue({ content: "Partial answer ", error: { code: 502, message: `${MARKER} disconnected` } }),
      },
    ])("$name", async ({ clientText, logText, streamed, failStream }) => {
      await createApiUser(1);
      failStream();
      const logs = captureLogs();

      const res = await complete({ stream: true });

      expect([res.statusCode, res.headers["content-type"]]).toEqual([200, "text/event-stream"]);
      expect(chunksOf(res.body).map((c) => c.choices?.[0]?.delta?.content ?? "").join("")).toBe(streamed);
      expect(sseErrorMessages(res.body)).toEqual([`${clientText}. No credits were charged.`]);
      expect(sseData(res.body).pop()).toMatch(/^\{"error"/);
      expect(res.body).not.toContain("[DONE]");
      expect(res.body).not.toContain(MARKER);
      expect(logs.lines).toContain(`Stream error: ${logText}`);
      expect(logs.lines.filter((l) => l.includes(MARKER))).toEqual([]);
      const record = await callRecord();
      expect(record.entries.map(([outcome, , , , amount]) => [outcome, amount])).toEqual([["provider_error", "0.000000"]]);
      expect([record.reservations, record.held]).toEqual([["released"], "0.000000"]);
      await assertCreditLedgerInvariants(prisma);
    });
  });

  it.each([
    ["stream false", { stream: false }],
    ["stream absent", {}],
  ])("AC6: %s → the JSON chat.completion as before, one completed entry", async (_name, payload) => {
    await createApiUser(1);
    fake.enqueue({ content: "Hello there", usage: { prompt_tokens: 10, completion_tokens: 2 } });

    const res = await complete(payload);

    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toMatch(/^application\/json/);
    expect(res.json()).toMatchObject({
      object: "chat.completion",
      model: MODEL,
      choices: [{ message: { content: "Hello there" } }],
      usage: { prompt_tokens: 10, completion_tokens: 2, total_tokens: 12 },
    });
    expect((await callRecord()).entries).toEqual([["completed", 10, 0, 2, "-0.000012"]]);
    await assertCreditLedgerInvariants(prisma);
  });

  describe("AC7 (negative): an invalid stream request → 400, nothing reserved", () => {
    it.each([
      ['stream: "yes"', { stream: "yes" }, "stream"],
      ["stream: true with output_format", { stream: true, output_format: "pdf" }, "output_format"],
      ["stream_options.include_usage not a boolean", { stream: true, stream_options: { include_usage: "yes" } }, "stream_options"],
    ])("%s", async (_name, payload, field) => {
      await createApiUser(1);

      const res = await complete(payload);

      expect(res.statusCode).toBe(400);
      expect(res.json().error.details).toHaveProperty(field);
      expect(embedSingle).not.toHaveBeenCalled();
      expect(fake.requests).toHaveLength(0);
      expect(await prisma.creditReservation.count()).toBe(0);
      await assertCreditLedgerInvariants(prisma);
    });

    it("stream: true with output_format names the reason", async () => {
      await createApiUser(1);

      const res = await complete({ stream: true, output_format: "docx" });

      expect(res.json().error.details.output_format).toEqual(["output_format is not supported with stream"]);
    });
  });

  describe("AC8: store:true with stream:true saves the conversation only after a completed stream", () => {
    it("completed → the conversation is saved with the full answer", async () => {
      await createApiUser(1);
      fake.enqueue({ content: "Hello there friend", usage: { prompt_tokens: 30, completion_tokens: 3 } });

      const res = await complete({ stream: true, store: true });

      expect(sseData(res.body).pop()).toBe("[DONE]");
      expect(conversation.getOrCreateConversation).toHaveBeenCalledTimes(1);
      expect(conversation.saveMessages).toHaveBeenCalledWith("conversation-id", MESSAGES, "Hello there friend", undefined);
      await assertCreditLedgerInvariants(prisma);
    });

    it("cancelled (real socket) → no conversation, no message saved", async () => {
      await createApiUser(1);

      await cancelAfterFirstChunk({ store: true });

      expect((await callRecord()).entries.map(([outcome]) => outcome)).toEqual(["client_cancel"]);
      expect(conversation.getOrCreateConversation).not.toHaveBeenCalled();
      expect(conversation.saveMessages).not.toHaveBeenCalled();
      await assertCreditLedgerInvariants(prisma);
    }, 10000);

    it("failed mid-stream → no conversation, no message saved", async () => {
      await createApiUser(1);
      fake.enqueue({ content: "Partial answer ", error: { code: 502, message: "provider down" } });

      const res = await complete({ stream: true, store: true });

      expect(sseErrorMessages(res.body)).toEqual(["Provider request failed (502). No credits were charged."]);
      expect((await callRecord()).entries.map(([outcome]) => outcome)).toEqual(["provider_error"]);
      expect(conversation.getOrCreateConversation).not.toHaveBeenCalled();
      expect(conversation.saveMessages).not.toHaveBeenCalled();
      await assertCreditLedgerInvariants(prisma);
    });
  });
});
