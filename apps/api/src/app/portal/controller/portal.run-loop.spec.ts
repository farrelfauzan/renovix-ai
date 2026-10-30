import { ConfigModule } from "@nestjs/config";
import { TestingModule } from "@nestjs/testing";
import { NestFastifyApplication } from "@nestjs/platform-fastify";
import { PortalController } from "./portal.controller";
import { EntitlementService } from "../../offers/service/entitlement.service";
import { PortalTierService } from "../service/portal-tier.service";
import { CreditService } from "../../billing/service/credit.service";
import { ModelRegistryService } from "../../config/model-registry.service";
import { ConversationService } from "../../chat/service/conversation.service";
import { PromptTuningService } from "../../chat/service/prompt-tuning.service";
import { DocumentService } from "../../document/service/document.service";
import { GuardrailService } from "../../guardrail/service/guardrail.service";
import type { GuardrailResult } from "../../guardrail/dto/guardrail-result.dto";
import { KnowledgeService } from "../../knowledge/service/knowledge.service";
import { UsageService } from "../../usage/service/usage.service";
import { ProvidersModule } from "../../providers/providers.module";
import { ProviderHttpError } from "../../providers/errors/provider-http-error";
import { PrismaService } from "../../prisma/prisma.service";
import { createFastifyApp, createTestModule } from "../../../../test/test-module";
import { resetDatabase } from "../../../../test/test-database";
import { createUser } from "../../../../test/factories";
import { fundPaidWallet } from "../../../../test/credit-funding";
import { assertCreditLedgerInvariants } from "../../../../test/credit-ledger-invariants";
import { FakeProviderAdapter, withFakeProvider } from "../../../../test/fake-provider";
import { createResolvableModel } from "../../../../test/provider-model";
import { sseEvents } from "../../../../test/sse-client";
import { asSessionUser } from "../../../../test/as-session-user";

// RNX-16: characterization of the portal (PO) on POST /chat/portal/completions, as it is today: an input guardrail
// block on the free and the paid path, the exact SSE events of a paid plain reply, and a paid call whose first attempt
// answers 503 and falls over to the model's fallback (RNX-179). Real PortalController, PortalTierService, CreditService
// and ModelRegistryService on the test database; fake provider; the guardrail and the conversation store are stubs.
// These collaborators load ESM-only packages.
jest.mock("../../chat/service/conversation.service", () => ({ ConversationService: class {} }));
jest.mock("../../chat/service/prompt-tuning.service", () => ({ PromptTuningService: class {} }));
jest.mock("../../document/service/document.service", () => ({ DocumentService: class {} }));
jest.mock("../../guardrail/service/guardrail.service", () => ({ GuardrailService: class {} }));
jest.mock("../../knowledge/service/knowledge.service", () => ({ KnowledgeService: class {} }));
jest.mock("../../usage/service/usage.service", () => ({ UsageService: class {} }));
process.env.IP_HASH_SECRET = "rnx16-test-secret";

const FREE_SESSION = "16161616-1616-4161-8161-161616161616";
const PAID_SESSION = "61616161-6161-4616-8616-616161616161";
const CONVERSATION_ID = "conversation-id";
const DECLINE = "INPUT-BLOCKED-REPLY";
const notBlocked = async (): Promise<GuardrailResult> => ({ blocked: false });
const blocked = async (): Promise<GuardrailResult> => ({ blocked: true, reason: "prompt_injection", userMessage: DECLINE });

/** One chunk of the fake's stream (FakeProviderAdapter.chatStream) for its `requestNumber`-th recorded request. */
const fakeChunk = (requestNumber: number, slug: string, choice: object, extra: object = {}) => ({
  id: `gen-fake-${requestNumber}`,
  object: "chat.completion.chunk",
  created: 0,
  model: slug,
  choices: [{ index: 0, finish_reason: null, ...choice }],
  ...extra,
});

describe("RNX-16: portal scenarios on POST /chat/portal/completions (Fastify, test database, fake provider)", () => {
  const fake = new FakeProviderAdapter();
  const mockCheckInput = jest.fn(notBlocked);
  const mockSaveMessages = jest.fn(async () => undefined);
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let app: NestFastifyApplication;

  beforeAll(async () => {
    ({ moduleRef, prisma } = await createTestModule(
      {
        imports: [ConfigModule.forRoot({ isGlobal: true, ignoreEnvFile: true }), ProvidersModule],
        controllers: [PortalController],
        providers: [
          EntitlementService,
          PortalTierService,
          CreditService,
          ModelRegistryService,
          {
            provide: PromptTuningService,
            useValue: { applyTuning: async (messages: unknown) => ({ tunedMessages: messages, matchedTemplate: null }) },
          },
          { provide: GuardrailService, useValue: { checkInput: mockCheckInput } },
          {
            provide: ConversationService,
            useValue: {
              getOrCreateConversation: async () => CONVERSATION_ID,
              saveMessages: mockSaveMessages,
              generateTitle: async () => undefined,
            },
          },
          { provide: KnowledgeService, useValue: { listKnowledgeBases: async () => [] } },
          { provide: DocumentService, useValue: {} },
          { provide: UsageService, useValue: { logUsage: async () => undefined } },
        ],
      },
      (b) => withFakeProvider(b, fake),
    ));
    app = await createFastifyApp(moduleRef);
  });

  beforeEach(async () => {
    await resetDatabase(prisma);
    fake.requests.length = 0;
    mockCheckInput.mockReset().mockImplementation(notBlocked);
    mockSaveMessages.mockClear();
    await prisma.tierRate.create({
      data: { tier: "standard", inputCreditsPerToken: 1, cachedCreditsPerToken: 1, outputCreditsPerToken: 1 },
    });
  });

  afterEach(() => jest.restoreAllMocks());

  afterAll(async () => {
    await app?.close();
  });

  /** The standard model "test-model" (and its registry reloaded); returns its row. */
  const seedModel = async () => {
    const created = await createResolvableModel(prisma, { slug: "test-model", modelName: "test-model", maxTokens: 8192 });
    await moduleRef.get(ModelRegistryService).refresh();
    return created.model;
  };

  /** A user funded with 1 credit through the ledger, and the portal headers of their signed-in session. */
  const seedPaidUser = async () => {
    const user = await createUser(prisma);
    await fundPaidWallet(prisma, user.id, "1");
    return { user, headers: { "x-portal-session": PAID_SESSION, ...asSessionUser(user) } };
  };

  const complete = (headers: Record<string, string>, payload: object) =>
    app.inject({ method: "POST", url: "/chat/portal/completions", headers, payload });

  const usageEntries = () => prisma.creditLedgerEntry.findMany({ where: { type: "usage" }, orderBy: { seq: "asc" } });

  it("RNX-16 input guardrail block (PO free): the decline is the only content chunk, then [DONE]; no model call; checked with the portal session id; the blocked message still counts against the session's free requests", async () => {
    await seedModel();
    mockCheckInput.mockImplementation(blocked);

    const actual = await complete({ "x-portal-session": FREE_SESSION }, { messages: [{ role: "user", content: "Hi" }] });

    expect([actual.statusCode, actual.headers["content-type"]]).toEqual([200, "text/event-stream"]);
    expect(sseEvents(actual.body)).toEqual([{ choices: [{ delta: { content: DECLINE } }] }, "[DONE]"]);
    expect(fake.requests).toHaveLength(0);
    expect(mockCheckInput.mock.calls).toEqual([["Hi", FREE_SESSION]]);
    // Today the free counters are reserved before the guardrail check, so a blocked message uses one free request.
    const session = await prisma.portalSession.findUniqueOrThrow({ where: { sessionToken: FREE_SESSION } });
    expect(session.requestCount).toBe(1);
    expect(mockSaveMessages).not.toHaveBeenCalled();
  });

  it("RNX-16 input guardrail block (PO paid): the decline is the only content chunk, then [DONE]; no model call, no reservation, no usage entry, nothing saved", async () => {
    await seedModel();
    const { user, headers } = await seedPaidUser();
    mockCheckInput.mockImplementation(blocked);

    const actual = await complete(headers, { model: "test-model", messages: [{ role: "user", content: "Hi" }] });

    expect([actual.statusCode, actual.headers["content-type"]]).toEqual([200, "text/event-stream"]);
    expect(sseEvents(actual.body)).toEqual([{ choices: [{ delta: { content: DECLINE } }] }, "[DONE]"]);
    expect(fake.requests).toHaveLength(0);
    expect(mockCheckInput.mock.calls).toEqual([["Hi", user.id]]);
    expect([await prisma.creditReservation.count(), (await usageEntries()).length]).toEqual([0, 0]);
    expect(mockSaveMessages).not.toHaveBeenCalled();
    await assertCreditLedgerInvariants(prisma);
  });

  it("RNX-16 plain reply (PO paid): the exact SSE events are two statuses, the provider's chunks as streamed, the conversation id, [DONE]; the usage entry has the reported tokens and the answer is saved", async () => {
    await seedModel();
    const { headers } = await seedPaidUser();
    fake.enqueue({ content: "Hello there", usage: { prompt_tokens: 10, completion_tokens: 5 } });

    const actual = await complete(headers, { model: "test-model", messages: [{ role: "user", content: "Hi" }] });

    expect([actual.statusCode, actual.headers["content-type"]]).toEqual([200, "text/event-stream"]);
    expect(sseEvents(actual.body)).toEqual([
      { status: "understanding" },
      { status: "generating" },
      fakeChunk(1, "test-model", { delta: { role: "assistant", content: "Hello " } }),
      fakeChunk(1, "test-model", { delta: { role: "assistant", content: "there" } }),
      fakeChunk(1, "test-model", { delta: {}, finish_reason: "stop" }),
      fakeChunk(1, "test-model", { delta: { role: "assistant", content: "" }, finish_reason: "stop" }, {
        usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
      }),
      { conversation_id: CONVERSATION_ID },
      "[DONE]",
    ]);
    const entries = await usageEntries();
    expect(entries.map((e) => [e.outcome, e.modelId, e.tokensNew, e.tokensCached, e.tokensOut, e.amount.toFixed(6)])).toEqual([
      ["completed", "test-model", 10, 0, 5, "-0.000015"],
    ]);
    expect(mockSaveMessages.mock.calls).toEqual([[CONVERSATION_ID, [{ role: "user", content: "Hi" }], "Hello there"]]);
    await assertCreditLedgerInvariants(prisma);
  });

  it("RNX-16 router fallback (PO paid): the first attempt answers 503, the answer streams from the fallback model, and exactly one provider_error usage entry is written for the failed attempt", async () => {
    const primary = await seedModel();
    const fallback = await createResolvableModel(prisma, { slug: "fallback-model", modelName: "fallback-model", maxTokens: 8192 });
    await prisma.aiModelFallback.create({ data: { modelId: primary.id, fallbackModelId: fallback.model.id, position: 0 } });
    await moduleRef.get(ModelRegistryService).refresh();
    const { user, headers } = await seedPaidUser();
    // The fake streams a scripted error as a mid-stream chunk; a 503 before the first payload is thrown here instead.
    const chatStream = jest.spyOn(fake, "chatStream").mockImplementationOnce(async function* () {
      throw new ProviderHttpError({ status: 503, kind: "unavailable" });
    });
    fake.enqueue({ content: "From fallback", usage: { prompt_tokens: 10, completion_tokens: 5 } });

    const actual = await complete(headers, { model: "test-model", messages: [{ role: "user", content: "Hi" }] });

    expect(chatStream.mock.calls.map(([request]) => request.connection.slug)).toEqual(["test-model", "fallback-model"]);
    const content = sseEvents(actual.body)
      .map((event) => (event as { choices?: { delta?: { content?: string } }[] }).choices?.[0]?.delta?.content ?? "")
      .join("");
    expect(content).toBe("From fallback");
    const entries = await usageEntries();
    expect(entries.map((e) => [e.memberUserId, e.outcome, e.modelId, e.amount.toFixed(6)])).toEqual([
      [user.id, "provider_error", "test-model", "0.000000"],
      [user.id, "completed", "fallback-model", "-0.000015"],
    ]);
    const [reservation] = await prisma.creditReservation.findMany();
    expect([reservation.status, reservation.consumed.toFixed(6)]).toEqual(["settled", "0.000015"]);
    await assertCreditLedgerInvariants(prisma);
  });
});
