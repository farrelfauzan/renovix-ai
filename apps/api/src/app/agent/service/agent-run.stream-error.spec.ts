import { ConfigModule } from "@nestjs/config";
import { Test, TestingModule } from "@nestjs/testing";
import { AgentRunService } from "./agent-run.service";
import { AgentToolService } from "./agent-tool.service";
import { AgentMemoryService } from "./agent-memory.service";
import { KnowledgeService } from "../../knowledge/service/knowledge.service";
import { UsageService } from "../../usage/service/usage.service";
import { GuardrailService } from "../../guardrail/service/guardrail.service";
import { ModelRegistryService } from "../../config/model-registry.service";
import { ProvidersModule } from "../../providers/providers.module";
import { PrismaService } from "../../prisma/prisma.service";
import { AgentRepository } from "../repository/agent.repository";
import {
  blockOutbound,
  OutboundBlocker,
  pointLlmAtStubs,
  sendJson,
  startStubHttpServer,
  StubHttpServer,
} from "../../../../test/llm-stub";

// RX-169: AgentRunService.streamExecution is the one ProviderRouter.chatStream
// caller outside the portal. No route calls it today (POST /agents/:id/chat uses
// the non-streaming AgentRunService.chat); it reads only `error.message`. A
// provider 400 must end the run with an error event, not a throw. Real
// OpenRouterAdapter against a local stub, no database (the error path does not
// use it); these collaborators load ESM-only packages.
jest.mock("./agent-tool.service", () => ({ AgentToolService: class {} }));
jest.mock("../../knowledge/service/knowledge.service", () => ({ KnowledgeService: class {} }));
jest.mock("../../guardrail/service/guardrail.service", () => ({ GuardrailService: class {} }));

const PRIMARY_KEY = "rx169-marker-key-not-real-primary";

describe("RX-169: provider error on AgentRunService.streamExecution", () => {
  let primary: StubHttpServer;
  let blocker: OutboundBlocker;
  let restoreEnv: () => void;
  let moduleRef: TestingModule;

  beforeAll(async () => {
    primary = await startStubHttpServer();
    restoreEnv = pointLlmAtStubs({ primary, apiKey: PRIMARY_KEY });
    moduleRef = await Test.createTestingModule({
      imports: [ConfigModule.forRoot({ isGlobal: true, ignoreEnvFile: true }), ProvidersModule],
      providers: [
        AgentRunService,
        { provide: PrismaService, useValue: {} },
        { provide: ModelRegistryService, useValue: {} },
        { provide: AgentToolService, useValue: {} },
        { provide: AgentMemoryService, useValue: {} },
        { provide: KnowledgeService, useValue: {} },
        { provide: UsageService, useValue: {} },
        { provide: GuardrailService, useValue: {} },
        { provide: AgentRepository, useValue: {} },
      ],
    }).compile();
  });

  beforeEach(() => {
    blocker = blockOutbound();
  });

  afterEach(() => blocker.restore());

  afterAll(async () => {
    await moduleRef?.close();
    await primary?.close();
    restoreEnv?.();
  });

  it("provider answers 400 on the stream → one 'done' event naming 400, no throw", async () => {
    primary.respond((_r, res) => sendJson(res, 400, { error: { message: "unknown model" } }));
    const context = {
      agentId: "agent-1",
      userId: "user-1",
      systemPrompt: "",
      model: "test-model",
      providerId: "vendor/test-model",
      provider: "openrouter",
      temperature: 0.7,
      tools: [],
      knowledgeBaseIds: [],
    };
    const events: unknown[] = [];

    for await (const event of moduleRef
      .get(AgentRunService)
      .streamExecution(context, [{ role: "user", content: "Hi" }], [], "run-1", { agentType: "standalone" })) {
      events.push(event);
    }

    expect(events).toEqual([
      { type: "done", content: expect.stringMatching(/^Error during streaming: .*400/), totalTokens: 0 },
    ]);
    expect(primary.requests).toHaveLength(1);
    expect(primary.requests[0].body.stream).toBe(true);
  });
});
