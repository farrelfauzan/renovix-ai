import axios from "axios";
import { ConfigModule } from "@nestjs/config";
import { JwtModule } from "@nestjs/jwt";
import { TestingModule } from "@nestjs/testing";
import { NestFastifyApplication } from "@nestjs/platform-fastify";
import { ProvidersModule } from "./providers.module";
import { FAKE_REPLY, FAKE_TOOL_KEYWORD } from "./fake.adapter";
import { PrismaService } from "../prisma/prisma.service";
import { ModelRegistryService } from "../config/model-registry.service";
import { PortalController } from "../portal/portal.controller";
import { PortalTierService } from "../portal/portal-tier.service";
import { PortalGuard } from "../portal/portal.guard";
import { BillingService } from "../billing/billing.service";
import { UsageService } from "../usage/usage.service";
import { PromptTuningService } from "../chat/prompt-tuning.service";
import { ConversationService } from "../chat/conversation.service";
import { KnowledgeService } from "../knowledge/knowledge.service";
import { KnowledgeController } from "../knowledge/knowledge.controller";
import { EmbeddingService } from "../knowledge/embedding.service";
import { S3Service } from "../knowledge/s3.service";
import { GuardrailService } from "../guardrail/guardrail.service";
import { DocumentService } from "../document/document.service";
import { AgentRunService } from "../agent/agent-run.service";
import { AgentToolService } from "../agent/agent-tool.service";
import { AgentMemoryService } from "../agent/agent-memory.service";
import { createFastifyApp, createTestModule } from "../../../test/test-module";
import { resetDatabase } from "../../../test/test-database";
import {
  createAgent,
  createPlan,
  createSubscription,
  createUser,
} from "../../../test/factories";

// RX-88: the API with LLM_PROVIDER=fake, no OPENROUTER_API_KEY and every
// outbound HTTP client blocked. These collaborators load ESM-only packages
// and are stubbed (see portal.controller.spec.ts).
jest.mock("../../lib/auth", () => ({
  auth: { api: { getSession: async () => null } },
}));
jest.mock("../billing/billing.service", () => ({ BillingService: class {} }));
jest.mock("../usage/usage.service", () => ({ UsageService: class {} }));
jest.mock("../chat/prompt-tuning.service", () => ({ PromptTuningService: class {} }));
jest.mock("../chat/conversation.service", () => ({ ConversationService: class {} }));
jest.mock("../guardrail/guardrail.service", () => ({ GuardrailService: class {} }));
jest.mock("../document/document.service", () => ({ DocumentService: class {} }));
jest.mock("../agent/agent-tool.service", () => ({ AgentToolService: class {} }));
jest.mock("../knowledge/s3.service", () => ({ S3Service: class {} }));

// The module objects themselves (a namespace import's properties cannot be spied on).
const http: typeof import("http") = require("http");
const https: typeof import("https") = require("https");

const ENV_KEYS = ["LLM_PROVIDER", "OPENROUTER_API_KEY", "IP_HASH_SECRET"] as const;
const savedEnv = ENV_KEYS.map((k) => process.env[k]);
const savedAdapter = axios.defaults.adapter;
const outbound: string[] = [];
const block = (name: string) => (..._args: unknown[]): never => {
  outbound.push(name);
  throw new Error(`RX-88: outbound ${name} call in fake mode`);
};

beforeAll(() => {
  process.env.LLM_PROVIDER = "fake";
  delete process.env.OPENROUTER_API_KEY;
  process.env.IP_HASH_SECRET = "rx88-test-secret";
  jest.spyOn(globalThis, "fetch").mockImplementation(block("fetch"));
  jest.spyOn(http, "request").mockImplementation(block("http.request"));
  jest.spyOn(https, "request").mockImplementation(block("https.request"));
  jest.spyOn(http, "get").mockImplementation(block("http.get"));
  jest.spyOn(https, "get").mockImplementation(block("https.get"));
  axios.defaults.adapter = block("axios") as any;
});

afterEach(() => expect(outbound.splice(0)).toEqual([]));

afterAll(() => {
  jest.restoreAllMocks();
  axios.defaults.adapter = savedAdapter;
  ENV_KEYS.forEach((k, i) => {
    if (savedEnv[i] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[i];
  });
});

it("control: the blocker catches axios, fetch and https", async () => {
  await expect(axios.post("https://openrouter.ai/api/v1/embeddings", {})).rejects.toThrow(/outbound axios/);
  expect(() => fetch("https://openrouter.ai")).toThrow(/outbound fetch/);
  expect(() => https.request("https://openrouter.ai")).toThrow(/outbound https.request/);
  expect(outbound.splice(0)).toEqual(["axios", "fetch", "https.request"]);
});

/** The content deltas and the usage chunk of an SSE body. */
const parseSse = (body: string) => {
  const payloads = body
    .split("\n\n")
    .filter((l) => l.startsWith("data: ") && l !== "data: [DONE]")
    .map((l) => JSON.parse(l.slice(6)));
  return {
    deltas: payloads.map((p) => p.choices?.[0]?.delta?.content).filter(Boolean),
    usage: payloads.find((p) => p.usage)?.usage,
  };
};

describe("RX-88: POST /chat/portal/completions with LLM_PROVIDER=fake", () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let app: NestFastifyApplication;

  beforeAll(async () => {
    ({ moduleRef, prisma } = await createTestModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true, ignoreEnvFile: true }),
        JwtModule.register({ secret: "rx88-test-jwt" }),
        ProvidersModule,
      ],
      controllers: [PortalController],
      providers: [
        PortalTierService,
        PortalGuard,
        ModelRegistryService,
        {
          provide: PromptTuningService,
          useValue: {
            applyTuning: async (messages: unknown) => ({ tunedMessages: messages, matchedTemplate: null }),
          },
        },
        { provide: GuardrailService, useValue: { checkInput: async () => ({ blocked: false }) } },
        { provide: BillingService, useValue: {} },
        { provide: UsageService, useValue: {} },
        { provide: ConversationService, useValue: {} },
        { provide: KnowledgeService, useValue: {} },
        { provide: DocumentService, useValue: {} },
      ],
    }));
    app = await createFastifyApp(moduleRef);
  });

  beforeEach(async () => {
    await resetDatabase(prisma);
    await prisma.aiModel.create({
      data: {
        slug: "standard-cheap",
        modelName: "standard-cheap",
        provider: "openrouter",
        providerId: "vendor/standard-cheap",
        inputPrice: "0.000001",
        outputPrice: "0.000001",
        maxTokens: 8192,
        tier: "standard",
      },
    });
    await moduleRef.get(ModelRegistryService).refresh();
  });

  afterAll(() => app?.close());

  it("AC4/AC5: a streaming chat asking for the real provider (header, query, body) still gets the canned reply, no outbound call", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/chat/portal/completions?provider=openrouter",
      headers: {
        "x-portal-session": "88888888-8888-4888-8888-888888888888",
        "x-llm-provider": "openrouter",
      },
      payload: {
        provider: "openrouter",
        messages: [{ role: "user", content: "Hello there" }],
      },
    });

    expect(res.statusCode).toBe(200);
    const { deltas, usage } = parseSse(res.body);
    expect(deltas.join("")).toBe(FAKE_REPLY);
    expect(deltas.length).toBe(FAKE_REPLY.split(" ").length); // one chunk per word
    expect(usage).toEqual({
      prompt_tokens: Math.ceil("Hello there".length / 4),
      completion_tokens: Math.ceil(FAKE_REPLY.length / 4),
      total_tokens: Math.ceil("Hello there".length / 4) + Math.ceil(FAKE_REPLY.length / 4),
    });
    expect(res.body).toContain("data: [DONE]");
  });
});

describe("RX-88: agent runs (chat, streaming, tool call) with LLM_PROVIDER=fake", () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let service: AgentRunService;
  const ECHO = { type: "function", function: { name: "echo", description: "Echo", parameters: {} } };
  const executeTool = jest.fn(async () => "echo result");

  beforeAll(async () => {
    ({ moduleRef, prisma } = await createTestModule({
      imports: [ConfigModule.forRoot({ isGlobal: true, ignoreEnvFile: true }), ProvidersModule],
      providers: [
        AgentRunService,
        ModelRegistryService,
        {
          provide: AgentToolService,
          useValue: {
            buildToolSchemasWithMcp: async () => [ECHO],
            executeTool,
            cleanupMcpConnections: async () => undefined,
          },
        },
        {
          provide: AgentMemoryService,
          useValue: { getMemoryContext: async () => "", extractAndStore: async () => undefined },
        },
        { provide: KnowledgeService, useValue: {} },
        { provide: UsageService, useValue: { logUsage: async () => undefined } },
        {
          provide: GuardrailService,
          useValue: {
            checkInput: async () => ({ blocked: false }),
            checkOutput: async (content: string) => ({ blocked: false, content }),
          },
        },
      ],
    }));
    service = moduleRef.get(AgentRunService);
  });

  beforeEach(async () => {
    await resetDatabase(prisma);
    executeTool.mockClear();
    await prisma.aiModel.create({
      data: {
        slug: "test-model",
        modelName: "test-model",
        provider: "openrouter",
        providerId: "vendor/test-model",
        inputPrice: 0.000001,
        outputPrice: 0.000001,
        maxTokens: 8192,
      },
    });
    await moduleRef.get(ModelRegistryService).refresh();
  });

  afterAll(() => moduleRef?.close());

  const seed = async () => {
    const plan = await createPlan(prisma);
    const user = await createUser(prisma);
    await createSubscription(prisma, { userId: user.id, planId: plan.id });
    const agent = await createAgent(prisma, { userId: user.id, status: "active" });
    return { user, agent };
  };

  const runStream = async (userId: string, agentId: string, message: string) => {
    const { run, context, messages, toolSchemas, agent } = await service.chatStream(userId, agentId, message);
    const events: any[] = [];
    for await (const event of service.streamExecution(context, messages, toolSchemas, run.id, agent)) {
      events.push(event);
    }
    return events;
  };

  it("AC5: a plain chat gets the canned reply and no tool runs", async () => {
    const { user, agent } = await seed();

    const res = await service.chat(user.id, agent.id, "Hi");

    expect(res.message.content).toBe(FAKE_REPLY);
    expect(executeTool).not.toHaveBeenCalled();
  });

  it(`AC5: a sync chat with ${FAKE_TOOL_KEYWORD} calls the first offered tool once, then ends with the canned reply`, async () => {
    const { user, agent } = await seed();

    const res = await service.chat(user.id, agent.id, `Use a tool ${FAKE_TOOL_KEYWORD}`);

    expect(executeTool).toHaveBeenCalledTimes(1);
    expect(executeTool).toHaveBeenCalledWith("echo", {}, expect.anything(), user.id);
    expect(res.message.content).toBe(FAKE_REPLY);
  });

  it(`AC5: a streaming chat with ${FAKE_TOOL_KEYWORD} calls the tool once, then streams the canned reply`, async () => {
    const { user, agent } = await seed();

    const events = await runStream(user.id, agent.id, `Use a tool ${FAKE_TOOL_KEYWORD}`);

    expect(executeTool).toHaveBeenCalledTimes(1);
    expect(events[events.length - 1]).toMatchObject({ type: "done", content: FAKE_REPLY });
    expect(events.filter((e) => e.type === "chunk")).toHaveLength(FAKE_REPLY.split(" ").length);
  });
});

describe("RX-88: knowledge chunks are embedded locally with LLM_PROVIDER=fake", () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let app: NestFastifyApplication;

  beforeAll(async () => {
    ({ moduleRef, prisma } = await createTestModule({
      imports: [ConfigModule.forRoot({ isGlobal: true, ignoreEnvFile: true })],
      controllers: [KnowledgeController],
      providers: [KnowledgeService, EmbeddingService, { provide: S3Service, useValue: {} }],
    }));
    app = await createFastifyApp(moduleRef);
  });

  beforeEach(() => resetDatabase(prisma));
  afterAll(() => app?.close());

  it("AC5: POST /v1/knowledge/bases/:id/chunks stores a 1024-dim vector; same text, same vector", async () => {
    const user = await createUser(prisma, { apiKey: "sk_live_rx88" });
    const kb = await prisma.knowledgeBase.create({ data: { userId: user.id, name: "KB" } });

    const res = await app.inject({
      method: "POST",
      url: `/v1/knowledge/bases/${kb.id}/chunks`,
      headers: { authorization: "Bearer sk_live_rx88" },
      payload: { chunks: [{ content: "alpha" }, { content: "beta" }, { content: "alpha" }] },
    });

    expect(res.statusCode).toBeLessThan(300);
    const rows = await prisma.$queryRaw<{ content: string; dims: number; v: string }[]>`
      SELECT content, vector_dims(embedding) AS dims, embedding::text AS v
      FROM knowledge_chunks WHERE "knowledgeBaseId" = ${kb.id} ORDER BY content`;
    expect(rows.map((r) => [r.content, r.dims])).toEqual([
      ["alpha", 1024],
      ["alpha", 1024],
      ["beta", 1024],
    ]);
    expect(rows[0].v).toBe(rows[1].v);
    expect(rows[0].v).not.toBe(rows[2].v);
  });
});
