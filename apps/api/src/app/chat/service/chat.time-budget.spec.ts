import { EventEmitter } from "node:events";
import type { ServerResponse } from "node:http";
import { ConfigService } from "@nestjs/config";
import { Decimal } from "@prisma/client/runtime/client";
import { ChatService } from "./chat.service";
import { ApiChatCompletionRequestSchema } from "../dto/chat-completion.dto";
import { OpenRouterAdapter } from "../../providers/openrouter.adapter";
import { ProviderRouter } from "../../providers/provider-router";
import { SseStream } from "../../../common/utils/sse-stream";
import { blockOutbound, OutboundBlocker, sendJson, chatCompletion, startStubHttpServer, StubHttpServer } from "../../../../test/llm-stub";

// RNX-44 AC9 (public API): POST /chat/completions reads the platform setting modelCallBudgetSeconds once per request and
// passes it as the call's `timeBudgetMs`; a changed setting applies to the next call. Real ChatService, ProviderRouter
// and OpenRouterAdapter against a local stub upstream (no database: the other collaborators are test doubles; the
// ESM-only ones are mocked as in the other chat specs). A budget that runs out is metered as a failed call.
jest.mock("../../usage/service/usage.service", () => ({ UsageService: class {} }));
jest.mock("./prompt-tuning.service", () => ({ PromptTuningService: class {} }));
jest.mock("./conversation.service", () => ({ ConversationService: class {} }));
jest.mock("../../document/service/document.service", () => ({ DocumentService: class {} }));

const SLUG = "fake/plain-model";
const MS_PER_SECOND = 1000;
const user = { id: "user-1", email: "u@example.com" };

describe("RNX-44 AC9: the public chat API passes the model call time budget", () => {
  let upstream: StubHttpServer;
  let blocker: OutboundBlocker;
  let credits: { assertAvailable: jest.Mock; reserve: jest.Mock; finishCall: jest.Mock; recordUsage: jest.Mock };
  let settings: { getSetting: jest.Mock };
  let router: ProviderRouter;
  let service: ChatService;

  beforeAll(async () => {
    upstream = await startStubHttpServer();
  });

  beforeEach(() => {
    blocker = blockOutbound();
    upstream.requests.length = 0;
    upstream.respond((_r, res) => sendJson(res, 200, chatCompletion("ok")));
    credits = {
      assertAvailable: jest.fn().mockResolvedValue(undefined),
      reserve: jest.fn().mockResolvedValue({ id: "reservation-1" }),
      finishCall: jest.fn().mockResolvedValue({ amount: new Decimal(0), tokensNew: 0, tokensCached: 0, tokensOut: 0 }),
      recordUsage: jest.fn().mockResolvedValue(undefined),
    };
    settings = { getSetting: jest.fn() };
    const registry = {
      resolveConnection: async (slug: string) => ({ slug, baseUrl: upstream.baseUrl, apiKey: "rnx44-not-real", providerName: "stub" }),
      getModel: async (slug: string) => ({ slug, tier: "standard" }),
      getTierRates: async () => ({ inputCreditsPerToken: new Decimal(1), cachedCreditsPerToken: new Decimal(1), outputCreditsPerToken: new Decimal(1) }),
    };
    const tuning = { applyTuning: async (messages: unknown) => ({ tunedMessages: messages, matchedTemplate: null }) };
    router = new ProviderRouter(new OpenRouterAdapter(new ConfigService()));
    service = new ChatService(credits as never, router, { logUsage: async () => undefined } as never, registry as never, tuning as never, {} as never, {} as never, settings as never);
  });

  afterEach(() => {
    blocker.restore();
    jest.restoreAllMocks();
  });

  afterAll(async () => {
    await upstream.close();
  });

  const body = { model: SLUG, messages: [{ role: "user" as const, content: "Hi" }], store: false };

  it("collected: each request reads the setting once and passes it; the changed value applies to the next call", async () => {
    const chat = jest.spyOn(router, "chat");
    settings.getSetting.mockResolvedValueOnce(30).mockResolvedValueOnce(45);

    await service.createCompletion(body, user);
    await service.createCompletion(body, user);

    expect(chat.mock.calls.map(([params]) => params.timeBudgetMs)).toEqual([30 * MS_PER_SECOND, 45 * MS_PER_SECOND]);
    expect(settings.getSetting.mock.calls).toEqual([["modelCallBudgetSeconds"], ["modelCallBudgetSeconds"]]);
  });

  it("stream: the request carries the budget too", async () => {
    const chatStream = jest.spyOn(router, "chatStream");
    settings.getSetting.mockResolvedValue(30);
    upstream.respond((_r, res) => {
      res.writeHead(200, { "Content-Type": "text/event-stream" });
      res.end('data: {"choices":[{"delta":{"content":"ok"}}]}\n\ndata: [DONE]\n\n');
    });
    const response = Object.assign(new EventEmitter(), { writeHead: jest.fn(), write: jest.fn(), end: jest.fn() });

    await service.streamCompletion(ApiChatCompletionRequestSchema.parse({ ...body, stream: true }), user, new SseStream(response as unknown as ServerResponse));

    expect(chatStream.mock.calls[0][0].timeBudgetMs).toBe(30 * MS_PER_SECOND);
  });

  it("a 1 s budget on a provider that never answers: the call fails within it, metered as a provider error (charged 0, hold released)", async () => {
    settings.getSetting.mockResolvedValue(1);
    upstream.respond(() => undefined);
    const startedAt = Date.now();

    await expect(service.createCompletion(body, user)).rejects.toThrow("No credits were charged");

    expect(Date.now() - startedAt).toBeLessThan(2 * MS_PER_SECOND);
    expect(credits.finishCall).toHaveBeenCalledTimes(1);
    expect(credits.finishCall.mock.calls[0][0]).toMatchObject({ outcome: "provider_error" });
  });

  it("control: the setting not set → no budget on the request", async () => {
    const chat = jest.spyOn(router, "chat");
    settings.getSetting.mockResolvedValue(null);

    await service.createCompletion(body, user);

    expect(chat.mock.calls[0][0]).not.toHaveProperty("timeBudgetMs");
  });
});
