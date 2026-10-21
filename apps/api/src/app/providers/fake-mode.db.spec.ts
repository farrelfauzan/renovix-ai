import axios from "axios";
import { ConfigModule } from "@nestjs/config";
import { TestingModule } from "@nestjs/testing";
import { NestFastifyApplication } from "@nestjs/platform-fastify";
import { ProvidersModule } from "./providers.module";
import { ProviderRouter } from "./provider-router";
import { FAKE_REPLY, FAKE_TOOL_KEYWORD } from "./fake.adapter";
import { PrismaService } from "../prisma/prisma.service";
import { ModelRegistryService } from "../config/model-registry.service";
import { PortalController } from "../portal/controller/portal.controller";
import { PortalTierService } from "../portal/service/portal-tier.service";
import { CreditService } from "../billing/service/credit.service";
import { UsageService } from "../usage/service/usage.service";
import { PromptTuningService } from "../chat/service/prompt-tuning.service";
import { ConversationService } from "../chat/service/conversation.service";
import { KnowledgeService } from "../knowledge/service/knowledge.service";
import { WorkspaceKnowledgeService } from "../workspace/service/workspace-knowledge.service";
import { KnowledgeController } from "../knowledge/controller/knowledge.controller";
import { EmbeddingService } from "../knowledge/service/embedding.service";
import { S3Service } from "../knowledge/service/s3.service";
import { GuardrailService } from "../guardrail/service/guardrail.service";
import { DocumentService } from "../document/service/document.service";
import { AgentRunService } from "../agent/service/agent-run.service";
import { AgentToolService } from "../agent/service/agent-tool.service";
import { AgentMemoryService } from "../agent/service/agent-memory.service";
import { AgentRunMeterService } from "../agent/service/agent-run-meter.service";
import { PlatformSettingsService } from "../offers/service/platform-settings.service";
import { fundPaidWallet } from "../../../test/credit-funding";
import { createFastifyApp, createTestModule } from "../../../test/test-module";
import { resetDatabase } from "../../../test/test-database";
import {
  createAgent,
  createPlan,
  createSubscription,
  createUser,
} from "../../../test/factories";
import { AgentLinkService } from "../agent/service/agent-link.service";
import { WorkspaceQuotaService } from "../workspace/service/workspace-quota.service";

// RX-88: the API with LLM_PROVIDER=fake, no OPENROUTER_API_KEY and every
// outbound HTTP client blocked. These collaborators load ESM-only packages
// and are stubbed (see portal.controller.spec.ts).
jest.mock("../../lib/auth", () => ({
  auth: { api: { getSession: async () => null } },
}));
jest.mock("../usage/service/usage.service", () => ({ UsageService: class {} }));
jest.mock("../chat/service/prompt-tuning.service", () => ({ PromptTuningService: class {} }));
jest.mock("../chat/service/conversation.service", () => ({ ConversationService: class {} }));
jest.mock("../guardrail/service/guardrail.service", () => ({ GuardrailService: class {} }));
jest.mock("../document/service/document.service", () => ({ DocumentService: class {} }));
jest.mock("../agent/service/agent-tool.service", () => ({ AgentToolService: class {} }));
jest.mock("../knowledge/service/s3.service", () => ({ S3Service: class {} }));

// The module objects themselves (a namespace import's properties cannot be spied on).
const http: typeof import("http") = require("http");
const https: typeof import("https") = require("https");

const ENV_KEYS = ["LLM_PROVIDER", "OPENROUTER_API_KEY", "LLM_API_KEY", "EMBEDDING_API_KEY", "IP_HASH_SECRET"] as const;
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
  delete process.env.LLM_API_KEY; // RX-160: fake mode refuses these keys too
  delete process.env.EMBEDDING_API_KEY;
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
        ProvidersModule,
      ],
      controllers: [PortalController],
      providers: [
        PortalTierService,
        ModelRegistryService,
        {
          provide: PromptTuningService,
          useValue: {
            applyTuning: async (messages: unknown) => ({ tunedMessages: messages, matchedTemplate: null }),
          },
        },
        { provide: GuardrailService, useValue: { checkInput: async () => ({ blocked: false }) } },
        { provide: CreditService, useValue: {} },
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

describe("RX-88: agent runs (chat, tool call) with LLM_PROVIDER=fake", () => {
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
        AgentLinkService,
        WorkspaceQuotaService,
        AgentRunMeterService,
        CreditService,
        PlatformSettingsService,
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
        { provide: WorkspaceKnowledgeService, useValue: {} },
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
    // RX-22b: agent runs are charged on the ledger at the tier rate, also in fake mode.
    await prisma.tierRate.create({
      data: { tier: "standard", inputCreditsPerToken: 1, cachedCreditsPerToken: 1, outputCreditsPerToken: 1 },
    });
    await moduleRef.get(ModelRegistryService).refresh();
  });

  afterAll(() => moduleRef?.close());

  const seed = async () => {
    const plan = await createPlan(prisma);
    const user = await createUser(prisma);
    await createSubscription(prisma, { userId: user.id, planId: plan.id });
    await fundPaidWallet(prisma, user.id, "1");
    const agent = await createAgent(prisma, { userId: user.id, status: "active" });
    return { user, agent };
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
    expect(executeTool).toHaveBeenCalledWith("echo", {}, expect.anything(), expect.anything(), user.id);
    expect(res.message.content).toBe(FAKE_REPLY);
  });
});

describe("RX-178 (D199-5): LLM_PROVIDER=fake needs no provider or model rows", () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;

  beforeAll(async () => {
    ({ moduleRef, prisma } = await createTestModule({
      imports: [ConfigModule.forRoot({ isGlobal: true, ignoreEnvFile: true }), ProvidersModule],
      providers: [ModelRegistryService],
    }));
  });

  beforeEach(() => resetDatabase(prisma));
  afterAll(() => moduleRef?.close());

  it("resolveConnection answers any slug without a lookup, and a chat through it gets the canned reply with no outbound call", async () => {
    const registry = moduleRef.get(ModelRegistryService);
    await registry.refresh();

    const connection = await registry.resolveConnection("fake/no-such-row");
    const res = await moduleRef.get(ProviderRouter).chat({ model: "m", connection, messages: [{ role: "user", content: "Hi" }] });

    expect([await prisma.provider.count(), await prisma.aiModel.count()]).toEqual([0, 0]);
    expect(connection).toMatchObject({ slug: "fake/no-such-row", apiKey: "" });
    expect(res.choices[0].message.content).toBe(FAKE_REPLY);
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
