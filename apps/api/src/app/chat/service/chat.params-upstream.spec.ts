import { readFileSync } from "node:fs";
import { join } from "node:path";
import { EventEmitter } from "node:events";
import type { ServerResponse } from "node:http";
import { BadRequestException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Decimal } from "@prisma/client/runtime/client";
import { ChatController } from "../controller/chat.controller";
import { ChatService } from "./chat.service";
import { ApiChatCompletionRequestSchema } from "../dto/chat-completion.dto";
import { OpenRouterAdapter } from "../../providers/openrouter.adapter";
import { ProviderRouter } from "../../providers/provider-router";
import {
  blockOutbound,
  chatCompletion,
  OutboundBlocker,
  sendJson,
  sendSse,
  startStubHttpServer,
  StubHttpServer,
} from "../../../../test/llm-stub";

// RNX-199: POST /chat/completions passes response_format and reasoning_effort to the provider. Real ChatController,
// ChatService, ProviderRouter and OpenRouterAdapter against a local stub upstream (no database: the credit, registry,
// tuning, usage, conversation and document collaborators are test doubles; ESM-only ones are mocked as in the other
// chat specs). The assertions read what the stub upstream received.
jest.mock("../../usage/service/usage.service", () => ({ UsageService: class {} }));
jest.mock("./prompt-tuning.service", () => ({ PromptTuningService: class {} }));
jest.mock("./conversation.service", () => ({ ConversationService: class {} }));
jest.mock("../../document/service/document.service", () => ({ DocumentService: class {} }));

const PLAIN_SLUG = "fake/plain-model";
const REASONING_SLUG = "x/claude-opus-5-5";
const user = { id: "user-1", email: "u@example.com" };

describe("RNX-199: response_format and reasoning_effort reach the provider", () => {
  let upstream: StubHttpServer;
  let blocker: OutboundBlocker;
  let credits: { assertAvailable: jest.Mock; reserve: jest.Mock; finishCall: jest.Mock };
  let service: ChatService;
  let controller: ChatController;

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
      finishCall: jest.fn().mockResolvedValue({ amount: new Decimal(-1), tokensNew: 3, tokensCached: 0, tokensOut: 2 }),
    };
    const registry = {
      resolveConnection: async (slug: string) => ({ slug, baseUrl: upstream.baseUrl, apiKey: "rnx199-not-real", providerName: "stub" }),
      getModel: async (slug: string) => ({ slug, tier: "standard" }),
      getTierRates: async () => ({
        inputCreditsPerToken: new Decimal(1),
        cachedCreditsPerToken: new Decimal(1),
        outputCreditsPerToken: new Decimal(1),
      }),
      getAllModels: async () => [],
    };
    const tuning = { applyTuning: async (messages: unknown) => ({ tunedMessages: messages, matchedTemplate: null }) };
    const usage = { logUsage: async () => undefined };
    const router = new ProviderRouter(new OpenRouterAdapter(new ConfigService()));
    service = new ChatService(credits as never, router, usage as never, registry as never, tuning as never, {} as never, {} as never);
    controller = new ChatController(service);
  });

  afterEach(() => blocker.restore());

  afterAll(async () => {
    await upstream.close();
  });

  const send = async (payload: Record<string, unknown>) => {
    const res = { send: jest.fn() };
    await controller.createCompletion(
      { model: PLAIN_SLUG, messages: [{ role: "user", content: "Hi" }], ...payload },
      { user },
      res as never,
    );
    return res.send.mock.calls[0][0];
  };

  const stream = async (payload: Record<string, unknown>) => {
    const response = Object.assign(new EventEmitter(), { writeHead: jest.fn(), write: jest.fn(), end: jest.fn() });
    const body = ApiChatCompletionRequestSchema.parse({ model: PLAIN_SLUG, messages: [{ role: "user", content: "Hi" }], stream: true, ...payload });
    await service.streamCompletion(body, user, response as unknown as ServerResponse);
  };

  it("AC1: response_format json_object → the upstream receives it", async () => {
    await send({ response_format: { type: "json_object" } });

    expect(upstream.requests).toHaveLength(1);
    expect(upstream.requests[0].body.response_format).toEqual({ type: "json_object" });
  });

  it("AC1 (stream): response_format json_object → the streamed upstream call receives it", async () => {
    upstream.respond((_r, res) => sendSse(res, ['{"choices":[{"delta":{"content":"ok"}}]}']));

    await stream({ response_format: { type: "json_object" } });

    expect(upstream.requests).toHaveLength(1);
    expect(upstream.requests[0].body.stream).toBe(true);
    expect(upstream.requests[0].body.response_format).toEqual({ type: "json_object" });
  });

  it("AC2: reasoning_effort high on a reasoning-capable model → the upstream receives it", async () => {
    await send({ model: REASONING_SLUG, reasoning_effort: "high" });

    expect(upstream.requests[0].body.reasoning_effort).toBe("high");
  });

  it("AC3: reasoning_effort on a model without reasoning support → succeeds, not sent; the OpenAPI document says so", async () => {
    const body = await send({ reasoning_effort: "high" });

    expect(body.choices[0].message.content).toBe("ok");
    expect(upstream.requests[0].body).not.toHaveProperty("reasoning_effort");
    const document = JSON.parse(readFileSync(join(__dirname, "../../../../../../docs/openapi/portal.openapi.json"), "utf8"));
    const schema = document.paths["/api/v1/chat/completions"].post.requestBody.content["application/json"].schema;
    expect(schema.properties.reasoning_effort.description).toMatch(/ignored.*without reasoning support/i);
  });

  it("AC4: neither field → the upstream body carries neither key", async () => {
    await send({});

    expect(upstream.requests[0].body).not.toHaveProperty("response_format");
    expect(upstream.requests[0].body).not.toHaveProperty("reasoning_effort");
  });

  it("AC5: an invalid response_format (type xml) → 400, no hold, no upstream request", async () => {
    await expect(send({ response_format: { type: "xml" } })).rejects.toBeInstanceOf(BadRequestException);

    expect(credits.reserve).not.toHaveBeenCalled();
    expect(upstream.requests).toHaveLength(0);
  });
});
