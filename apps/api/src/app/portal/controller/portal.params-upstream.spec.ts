import { ConfigModule } from "@nestjs/config";
import { TestingModule } from "@nestjs/testing";
import { NestFastifyApplication } from "@nestjs/platform-fastify";
import { Decimal } from "@prisma/client/runtime/client";
import { PortalController } from "./portal.controller";
import { EntitlementService } from "../../offers/service/entitlement.service";
import { PortalTierService } from "../service/portal-tier.service";
import { PrismaService } from "../../prisma/prisma.service";
import { ModelRegistryService } from "../../config/model-registry.service";
import { ProvidersModule } from "../../providers/providers.module";
import { ProviderRouter } from "../../providers/provider-router";
import { CreditService } from "../../billing/service/credit.service";
import { ChatService } from "../../chat/service/chat.service";
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
import {
  blockOutbound,
  chatCompletion,
  OutboundBlocker,
  sendJson,
  sendSse,
  startStubHttpServer,
  StubHttpServer,
} from "../../../../test/llm-stub";
import { createResolvableModel } from "../../../../test/provider-model";
import { asSessionUser } from "../../../../test/as-session-user";

// RNX-221: POST /chat/portal/completions passes response_format and reasoning_effort upstream, free and paid, as
// /chat/completions does (RNX-199). The real portal route (Fastify, test database) and the real OpenRouterAdapter talk
// to a local stub upstream that records each request body; blockOutbound keeps every other host off the network.
jest.mock("../../usage/service/usage.service", () => ({ UsageService: class {} }));
jest.mock("../../chat/service/prompt-tuning.service", () => ({ PromptTuningService: class {} }));
jest.mock("../../chat/service/conversation.service", () => ({ ConversationService: class {} }));
jest.mock("../../knowledge/service/knowledge.service", () => ({ KnowledgeService: class {} }));
jest.mock("../../guardrail/service/guardrail.service", () => ({ GuardrailService: class {} }));
jest.mock("../../document/service/document.service", () => ({ DocumentService: class {} }));
process.env.IP_HASH_SECRET = "rnx221-test-secret";

const PLAIN_SLUG = "rnx221-cheap";
const REASONING_SLUG = "x/claude-opus-5-5";
const API_KEY = "rnx221-not-real";
const UPSTREAM_KEYS = ["max_tokens", "messages", "model", "stream", "stream_options", "temperature"];

describe("RNX-221: the portal route passes response_format and reasoning_effort upstream (Fastify, test database)", () => {
  let upstream: StubHttpServer;
  let blocker: OutboundBlocker;
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let app: NestFastifyApplication;

  beforeAll(async () => {
    upstream = await startStubHttpServer();
    ({ moduleRef, prisma } = await createTestModule({
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
        { provide: GuardrailService, useValue: { checkInput: async () => ({ blocked: false }) } },
        { provide: UsageService, useValue: { logUsage: async () => undefined } },
        {
          provide: ConversationService,
          useValue: { getOrCreateConversation: async () => "conversation-id", saveMessages: async () => undefined, generateTitle: async () => undefined },
        },
        { provide: KnowledgeService, useValue: { listKnowledgeBases: async () => [] } },
        { provide: DocumentService, useValue: {} },
      ],
    }));
    app = await createFastifyApp(moduleRef);
  });

  beforeEach(async () => {
    blocker = blockOutbound();
    upstream.requests.length = 0;
    upstream.respond((_r, res) => sendSse(res, ['{"choices":[{"delta":{"content":"ok"}}]}']));
    await resetDatabase(prisma);
    await prisma.tierRate.create({
      data: { tier: "standard", inputCreditsPerToken: 1, cachedCreditsPerToken: 1, outputCreditsPerToken: 1 },
    });
    // the free tier picks the cheapest standard model: the plain one
    await createResolvableModel(prisma, {
      slug: PLAIN_SLUG, modelName: PLAIN_SLUG, inputPrice: 0.000001, outputPrice: 0.000001, maxTokens: 8192,
      provider: { baseUrl: upstream.baseUrl, apiKey: API_KEY },
    });
    await createResolvableModel(prisma, {
      slug: REASONING_SLUG, modelName: REASONING_SLUG, inputPrice: 0.00001, outputPrice: 0.00001, maxTokens: 8192,
      provider: { baseUrl: upstream.baseUrl, apiKey: API_KEY },
    });
    await moduleRef.get(ModelRegistryService).refresh();
  });

  afterEach(() => blocker.restore());

  afterAll(async () => {
    await app?.close();
    await upstream?.close();
  });

  const freeChat = (payload: Record<string, unknown>) =>
    app.inject({
      method: "POST",
      url: "/chat/portal/completions",
      headers: { "x-portal-session": "22122122-1221-4221-8221-221221221221" },
      payload: { messages: [{ role: "user", content: "Hi" }], ...payload },
    });

  /** A paid chat by a user funded with 5 credits through the ledger. */
  const paidChat = async (payload: Record<string, unknown>) => {
    const user = await createUser(prisma);
    await fundPaidWallet(prisma, user.id, 5);
    const session = asSessionUser(user);
    return app.inject({
      method: "POST",
      url: "/chat/portal/completions",
      headers: { "x-portal-session": "22222222-2222-4222-8222-222222222221", ...session },
      payload: { model: PLAIN_SLUG, messages: [{ role: "user", content: "Hi" }], ...payload },
    });
  };

  const upstreamBody = () => {
    expect(upstream.requests).toHaveLength(1);
    return upstream.requests[0].body;
  };

  it("AC1: paid, response_format json_object → the upstream receives it", async () => {
    const res = await paidChat({ response_format: { type: "json_object" } });

    expect(res.body).toContain("data: [DONE]");
    expect(upstreamBody().response_format).toEqual({ type: "json_object" });
  });

  it("AC2: paid, reasoning_effort high on a reasoning-capable model → the upstream receives it", async () => {
    const res = await paidChat({ model: REASONING_SLUG, reasoning_effort: "high" });

    expect(res.body).toContain("data: [DONE]");
    expect(upstreamBody().reasoning_effort).toBe("high");
  });

  it("AC2b: paid, reasoning_effort on a model without reasoning support → succeeds, not sent", async () => {
    const res = await paidChat({ reasoning_effort: "high" });

    expect(res.body).toContain("data: [DONE]");
    expect(upstreamBody()).not.toHaveProperty("reasoning_effort");
  });

  it("AC3: free, response_format json_object → the upstream receives it", async () => {
    const res = await freeChat({ response_format: { type: "json_object" } });

    expect(res.body).toContain("data: [DONE]");
    expect(upstreamBody().model).toBe(PLAIN_SLUG);
    expect(upstreamBody().response_format).toEqual({ type: "json_object" });
  });

  it("AC3b: free, reasoning_effort while the cheapest model has no reasoning support → succeeds, not sent", async () => {
    const res = await freeChat({ reasoning_effort: "high" });

    expect(res.body).toContain("data: [DONE]");
    expect(upstreamBody().model).toBe(PLAIN_SLUG);
    expect(upstreamBody()).not.toHaveProperty("reasoning_effort");
  });

  it.each([
    ["free", () => freeChat({})],
    ["paid", () => paidChat({})],
  ])("AC4: %s, neither field → the upstream body has exactly today's keys", async (_tier, call) => {
    const res = await call();

    expect(res.body).toContain("data: [DONE]");
    expect(Object.keys(upstreamBody()).sort()).toEqual(UPSTREAM_KEYS);
  });

  it.each([
    ["free", () => freeChat({ response_format: { type: "xml" } })],
    ["paid", () => paidChat({ response_format: { type: "xml" } })],
  ])("AC5: %s, invalid response_format → 400, no reservation, no free-tier count, no upstream call", async (_tier, call) => {
    const res = await call();

    expect(res.statusCode).toBe(400);
    expect(await prisma.creditReservation.count()).toBe(0);
    expect(await prisma.anonymousUsageCounter.count()).toBe(0);
    expect(upstream.requests).toHaveLength(0);
  });

  it("AC6: the same request on /chat/completions and /chat/portal/completions → the same upstream response_format and reasoning_effort", async () => {
    const credits = {
      assertAvailable: async () => undefined,
      reserve: async () => ({ id: "reservation-1" }),
      finishCall: async () => ({ amount: new Decimal(-1), tokensNew: 3, tokensCached: 0, tokensOut: 2 }),
    };
    const registry = moduleRef.get(ModelRegistryService);
    const tuning = { applyTuning: async (messages: unknown) => ({ tunedMessages: messages, matchedTemplate: null }) };
    const chatService = new ChatService(
      credits as never, moduleRef.get(ProviderRouter), { logUsage: async () => undefined } as never, registry, tuning as never, {} as never, {} as never,
    );
    const params = { response_format: { type: "json_object" }, reasoning_effort: "high" };
    upstream.respond((_r, res) => sendJson(res, 200, chatCompletion("ok")));
    await chatService.createCompletion(
      { model: REASONING_SLUG, messages: [{ role: "user", content: "Hi" }], ...params } as never,
      { id: "user-1", email: "u@example.com" } as never,
    );
    upstream.respond((_r, res) => sendSse(res, ['{"choices":[{"delta":{"content":"ok"}}]}']));
    await paidChat({ model: REASONING_SLUG, ...params });

    const [viaChat, viaPortal] = upstream.requests.map((r) => [r.body.response_format, r.body.reasoning_effort]);
    expect(upstream.requests).toHaveLength(2);
    expect(viaPortal).toEqual(viaChat);
    expect(viaPortal).toEqual([{ type: "json_object" }, "high"]);
  });
});
