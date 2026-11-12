import { TestingModule } from "@nestjs/testing";
import { NestFastifyApplication } from "@nestjs/platform-fastify";
import { request as httpRequest } from "node:http";
import { AddressInfo } from "node:net";
import { AgentRunController } from "./agent-run.controller";
import { AgentRunService } from "../service/agent-run.service";
import { AgentRunMeterService } from "../service/agent-run-meter.service";
import { AgentToolService } from "../service/agent-tool.service";
import { AgentMemoryService } from "../service/agent-memory.service";
import { AgentLinkService } from "../service/agent-link.service";
import { AgentRunPolicyService } from "../service/agent-run-policy.service";
import { rememberOfferedTools } from "../utils/remember-offered-tools";
import type { McpRunSession } from "../types/mcp-run-session";
import type { ToolSchema } from "../types/tool-schema";
import { ChatEngineService } from "../../chat-engine/service/chat-engine.service";
import type { ChatEngineRunOptions } from "../../chat-engine/types/chat-engine-run-options";
import { KnowledgeService } from "../../knowledge/service/knowledge.service";
import { WorkspaceKnowledgeService } from "../../workspace/service/workspace-knowledge.service";
import { WorkspaceQuotaService } from "../../workspace/service/workspace-quota.service";
import { DocumentService } from "../../document/service/document.service";
import { UsageService } from "../../usage/service/usage.service";
import { GuardrailService } from "../../guardrail/service/guardrail.service";
import { ModelRegistryService } from "../../config/model-registry.service";
import { CreditService } from "../../billing/service/credit.service";
import { PlatformSettingsService } from "../../offers/service/platform-settings.service";
import { ProvidersModule } from "../../providers/providers.module";
import { PrismaService } from "../../prisma/prisma.service";
import { SseStream } from "../../../common/utils/sse-stream";
import { SSE_HEARTBEAT_INTERVAL_MS } from "../../../common/config/sse-heartbeat-interval-ms";
import { createFastifyApp, createTestModule } from "../../../../test/test-module";
import { resetDatabase } from "../../../../test/test-database";
import { createAgent, createPackageSnapshot, createUser } from "../../../../test/factories";
import { FakeProviderAdapter, withFakeProvider } from "../../../../test/fake-provider";
import { createResolvableModel } from "../../../../test/provider-model";
import { fundPaidWallet } from "../../../../test/credit-funding";
import { assertCreditLedgerInvariants } from "../../../../test/credit-ledger-invariants";
import { heartbeatTimersOf, isAbortedWithin } from "../../../../test/sse-socket";
import { asSessionUser } from "../../../../test/as-session-user";

// RNX-25 AC12 (D336): a client that leaves POST /agents/:id/chat during a run. The run's agent calls its one tool,
// `step`, which holds until the test lets it go; the client leaves while it runs. Then the engine run has the SSE
// helper's abort signal, no further model call starts, no answer is stored (the user's message is kept, D341 D2), the
// reservation is settled for the call that was charged and nothing stays held, and the heartbeat is cleared. Real
// AgentRunController, AgentRunService, meter and ledger on the test database; fake provider (its first turn is the
// document-intent classifier's "none"); the tool service, guardrail and memory are stubs. These collaborators load
// ESM-only packages.
jest.mock("../../knowledge/service/knowledge.service", () => ({ KnowledgeService: class {} }));
jest.mock("../../document/service/document.service", () => ({ DocumentService: class {} }));
jest.mock("../service/agent-tool.service", () => ({ AgentToolService: class {} }));
jest.mock("../../guardrail/service/guardrail.service", () => ({ GuardrailService: class {} }));

const STEP_SCHEMA = { type: "function", function: { name: "step", description: "step", parameters: { type: "object", properties: {} } } } as ToolSchema;

describe("RNX-25 AC12: a client that leaves the agent chat stops the run (Fastify, test database, fake provider)", () => {
  const fake = new FakeProviderAdapter();
  let toolStarted!: () => void;
  let releaseTool!: () => void;
  const tools = {
    buildToolSchemasWithMcp: jest.fn(async (_tools: unknown, _agentId: string, _userId: string, _workspaceId: string, options: { mcpSession: McpRunSession }) => {
      rememberOfferedTools(options.mcpSession, [STEP_SCHEMA]);
      return [STEP_SCHEMA];
    }),
    executeTool: jest.fn(async () => {
      toolStarted();
      await new Promise<void>((resolve) => (releaseTool = resolve));
      return "stepped";
    }),
    cleanupMcpConnections: jest.fn(async () => undefined),
  };
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let app: NestFastifyApplication;

  beforeAll(async () => {
    ({ moduleRef, prisma } = await createTestModule(
      {
        imports: [ProvidersModule],
        controllers: [AgentRunController],
        providers: [
          AgentRunService,
          AgentRunPolicyService,
          AgentLinkService,
          WorkspaceQuotaService,
          AgentRunMeterService,
          CreditService,
          PlatformSettingsService,
          ModelRegistryService,
          UsageService,
          { provide: AgentToolService, useValue: tools },
          { provide: AgentMemoryService, useValue: { getMemoryContext: async () => "", extractAndStore: async () => undefined } },
          { provide: KnowledgeService, useValue: {} },
          { provide: WorkspaceKnowledgeService, useValue: {} },
          { provide: DocumentService, useValue: {} },
          { provide: GuardrailService, useValue: { checkInput: async () => ({ blocked: false }), checkOutput: async (content: string) => ({ blocked: false, content }) } },
        ],
      },
      (b) => withFakeProvider(b, fake),
    ));
    app = await createFastifyApp(moduleRef);
  });

  beforeEach(async () => {
    await resetDatabase(prisma);
    fake.requests.length = 0;
    (fake as unknown as { turns: unknown[] }).turns.length = 0;
    await createResolvableModel(prisma, { slug: "test-model", modelName: "test-model", maxTokens: 8192 });
    await prisma.tierRate.create({ data: { tier: "standard", inputCreditsPerToken: 1, cachedCreditsPerToken: 1, outputCreditsPerToken: 1 } });
    await moduleRef.get(ModelRegistryService).refresh();
  });

  afterEach(() => jest.restoreAllMocks());

  afterAll(async () => {
    await app?.close();
  });

  /** Starts the chat over a real socket and returns the client, so the test can leave mid-run. */
  const startChat = async (agentId: string, headers: Record<string, string>) => {
    if (!app.getHttpServer().listening) await app.listen(0, "127.0.0.1");
    const { port } = app.getHttpServer().address() as AddressInfo;
    const client = httpRequest({ host: "127.0.0.1", port, method: "POST", path: `/agents/${agentId}/chat`, headers: { "content-type": "application/json", ...headers } });
    client.on("error", () => undefined); // destroyed on purpose
    client.end(JSON.stringify({ message: "Hi" }));
    return client;
  };

  it("the run gets the helper's signal; no further model call, no answer stored (the user's message kept), the charged call settled and nothing held, the heartbeat cleared", async () => {
    const user = await createUser(prisma);
    await createPackageSnapshot(prisma, { userId: user.id });
    await fundPaidWallet(prisma, user.id, "1");
    const agent = await createAgent(prisma, { userId: user.id, status: "active" });
    fake.enqueue(
      { content: "none" },
      { toolCalls: [{ name: "step", arguments: {} }], usage: { prompt_tokens: 10, completion_tokens: 5 } },
      { content: "Final answer", usage: { prompt_tokens: 10, completion_tokens: 5 } },
    );
    const open = jest.spyOn(SseStream.prototype, "open");
    const setIntervalSpy = jest.spyOn(global, "setInterval");
    const clearIntervalSpy = jest.spyOn(global, "clearInterval");
    const collect = jest.spyOn(ChatEngineService.prototype, "collect");
    const chat = jest.spyOn(moduleRef.get(AgentRunService), "chat");
    const isToolRunning = new Promise<void>((resolve) => (toolStarted = resolve));

    const client = await startChat(agent.id, asSessionUser(user));
    await isToolRunning;
    client.destroy();
    const sse = open.mock.contexts[0] as SseStream;
    const isAborted = await isAbortedWithin(sse.signal);
    releaseTool();
    await (chat.mock.results[0].value as Promise<unknown>).catch(() => undefined);

    expect(isAborted).toBe(true);
    expect(fake.requests).toHaveLength(2); // the classifier and the run's first call; no call after the client left
    expect((await prisma.agentMessage.findMany()).map((m) => [m.role, m.content])).toEqual([["user", "Hi"]]);
    const [reservation] = await prisma.creditReservation.findMany();
    expect([reservation.status, reservation.consumed.toFixed(6)]).toEqual(["settled", "0.000015"]);
    const account = await prisma.creditAccount.findUniqueOrThrow({ where: { userId_wallet: { userId: user.id, wallet: "paid" } } });
    expect([account.balance.toFixed(6), account.held.toFixed(6)]).toEqual(["0.999985", "0.000000"]);
    const heartbeats = heartbeatTimersOf(setIntervalSpy, SSE_HEARTBEAT_INTERVAL_MS);
    expect(heartbeats).toHaveLength(1);
    expect(clearIntervalSpy).toHaveBeenCalledWith(heartbeats[0]);
    expect((collect.mock.calls[0][1] as ChatEngineRunOptions).signal).toBe(sse.signal);
    await assertCreditLedgerInvariants(prisma);
  }, 15000);
});
