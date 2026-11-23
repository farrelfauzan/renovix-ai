import { TestingModule } from "@nestjs/testing";
import { NestFastifyApplication } from "@nestjs/platform-fastify";
import { request as httpRequest } from "node:http";
import { AddressInfo } from "node:net";
import { ChannelController } from "./channel.controller";
import { ChannelService } from "../service/channel.service";
import { ChannelChatService } from "../service/channel-chat.service";
import { S3Service } from "../../knowledge/service/s3.service";
import { DocumentService } from "../../document/service/document.service";
import { KnowledgeService } from "../../knowledge/service/knowledge.service";
import { WorkspaceKnowledgeService } from "../../workspace/service/workspace-knowledge.service";
import { AgentToolService } from "../../agent/service/agent-tool.service";
import { AgentMemoryService } from "../../agent/service/agent-memory.service";
import { AgentRunMeterService } from "../../agent/service/agent-run-meter.service";
import { AgentLinkService } from "../../agent/service/agent-link.service";
import { AgentRunPolicyService } from "../../agent/service/agent-run-policy.service";
import { rememberOfferedTools } from "../../agent/utils/remember-offered-tools";
import type { McpRunSession } from "../../agent/types/mcp-run-session";
import type { ToolSchema } from "../../agent/types/tool-schema";
import { ChatEngineService } from "../../chat-engine/service/chat-engine.service";
import type { ChatEngineRunOptions } from "../../chat-engine/types/chat-engine-run-options";
import { WorkspaceQuotaService } from "../../workspace/service/workspace-quota.service";
import { UsageService } from "../../usage/service/usage.service";
import { GuardrailService } from "../../guardrail/service/guardrail.service";
import { ModelRegistryService } from "../../config/model-registry.service";
import { CreditService } from "../../billing/service/credit.service";
import { PlatformSettingsService } from "../../offers/service/platform-settings.service";
import { ProvidersModule } from "../../providers/providers.module";
import type { ChatRequest } from "../../providers/provider.interface";
import { PrismaService } from "../../prisma/prisma.service";
import { SseStream } from "../../../common/utils/sse-stream";
import { createFastifyApp, createTestModule } from "../../../../test/test-module";
import { resetDatabase } from "../../../../test/test-database";
import { createAgent, createPackageSnapshot, createUser } from "../../../../test/factories";
import { FakeProviderAdapter, withFakeProvider } from "../../../../test/fake-provider";
import { createResolvableModel } from "../../../../test/provider-model";
import { fundPaidWallet } from "../../../../test/credit-funding";
import { setRunCap } from "../../../../test/run-cap";
import { assertCreditLedgerInvariants } from "../../../../test/credit-ledger-invariants";
import { requestOverSocket, sseEvents } from "../../../../test/sse-client";
import { isAbortedWithin } from "../../../../test/sse-socket";
import { asSessionUser } from "../../../../test/as-session-user";

// RNX-24a: POST /channels/:id/agents/:agentId/chat on the engine-backed channel chat. AC6: the refusals before the SSE
// headers (no classifier call, nothing saved); AC11: the stream is the shared SSE helper's; AC12 (D336) and AC8: a
// client that leaves while the run's first model call is running stops the run. Real ChannelController,
// ChannelChatService, meter and ledger on the test database; fake provider (the first call of a run that streams is
// the document-intent classifier's); the tool service, guardrail, memory and knowledge are stubs (ESM-only packages).
jest.mock("../../knowledge/service/s3.service", () => ({ S3Service: class {} }));
jest.mock("../../knowledge/service/knowledge.service", () => ({ KnowledgeService: class {} }));
jest.mock("../../document/service/document.service", () => ({ DocumentService: class {} }));
jest.mock("../../agent/service/agent-tool.service", () => ({ AgentToolService: class {} }));
jest.mock("../../guardrail/service/guardrail.service", () => ({ GuardrailService: class {} }));

const STEP_SCHEMA = { type: "function", function: { name: "step", description: "step", parameters: { type: "object", properties: {} } } } as ToolSchema;
/** The document-intent classifier's call (its fixed max_tokens). */
const isClassifierCall = (request: ChatRequest) => request.max_tokens === 200;

describe("RNX-24a: the channel chat route on the engine (Fastify, test database, fake provider)", () => {
  const fake = new FakeProviderAdapter();
  const tools = {
    buildToolSchemasWithMcp: jest.fn(async (_tools: unknown, _agentId: string, _userId: string, _workspaceId: string, options: { mcpSession: McpRunSession }) => {
      rememberOfferedTools(options.mcpSession, [STEP_SCHEMA]);
      return [STEP_SCHEMA];
    }),
    executeTool: jest.fn(async () => "stepped"),
    cleanupMcpConnections: jest.fn(async (_session: unknown) => undefined),
  };
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let app: NestFastifyApplication;

  beforeAll(async () => {
    ({ moduleRef, prisma } = await createTestModule(
      {
        imports: [ProvidersModule],
        controllers: [ChannelController],
        providers: [
          ChannelService,
          ChannelChatService,
          AgentRunPolicyService,
          AgentLinkService,
          WorkspaceQuotaService,
          AgentRunMeterService,
          CreditService,
          PlatformSettingsService,
          ModelRegistryService,
          UsageService,
          { provide: AgentToolService, useValue: tools },
          { provide: AgentMemoryService, useValue: { getWorkspaceMemoryContext: async () => "", extractAndStore: async () => undefined } },
          { provide: KnowledgeService, useValue: {} },
          { provide: WorkspaceKnowledgeService, useValue: {} },
          { provide: GuardrailService, useValue: { checkInput: async () => ({ blocked: false }), checkOutput: async (content: string) => ({ blocked: false, content }) } },
          { provide: S3Service, useValue: {} },
          { provide: DocumentService, useValue: {} },
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
    for (const mock of Object.values(tools)) mock.mockClear();
    await createResolvableModel(prisma, { slug: "test-model", modelName: "test-model", maxTokens: 8192 });
    await prisma.tierRate.create({ data: { tier: "standard", inputCreditsPerToken: 1, cachedCreditsPerToken: 1, outputCreditsPerToken: 1 } });
    await moduleRef.get(ModelRegistryService).refresh();
  });

  afterEach(() => jest.restoreAllMocks());

  afterAll(async () => {
    await app?.close();
  });

  /** A user (subscribed unless not, funded with `credits`, none for "0"), an agent in their channel, and a session cookie. */
  const seed = async ({ credits = "1", isSubscribed = true } = {}) => {
    const user = await createUser(prisma);
    if (isSubscribed) await createPackageSnapshot(prisma, { userId: user.id });
    if (credits !== "0") await fundPaidWallet(prisma, user.id, credits);
    const agent = await createAgent(prisma, { userId: user.id, status: "active" });
    const channel = await prisma.channel.create({ data: { userId: user.id, name: "Room" } });
    await prisma.channelAgent.create({ data: { channelId: channel.id, agentId: agent.id } });
    return { user, agent, channel, session: asSessionUser(user) };
  };

  const postChat = (channelId: string, agentId: string, session: { cookie: string }) =>
    requestOverSocket(app, { method: "POST", path: `/channels/${channelId}/agents/${agentId}/chat`, headers: session, body: { message: "Hi" } });

  const writtenRows = async () => [await prisma.channelMessage.count(), await prisma.creditReservation.count()];

  describe("AC6 (negative): refused before the SSE headers; no classifier call, nothing saved", () => {
    it.each([
      ["0 ledger credits", 402, "CREDITS_EXHAUSTED", { credits: "0" }],
      ["a first call over the per-run cap", 402, "RUN_CAP_EXCEEDED", { capCredits: 0.001 }],
      ["no active subscription", 403, undefined, { isSubscribed: false }],
    ] as const)("%s → HTTP %i %s", async (_case, status, code, setup) => {
      const { agent, channel, session } = await seed({ credits: "credits" in setup ? setup.credits : "1", isSubscribed: !("isSubscribed" in setup) });
      if ("capCredits" in setup) await setRunCap(prisma, setup.capCredits);
      const open = jest.spyOn(SseStream.prototype, "open");

      const res = await postChat(channel.id, agent.id, session);

      expect([res.statusCode, res.contentType]).toEqual([status, expect.stringContaining("application/json")]);
      expect(JSON.parse(res.body).code).toBe(code);
      expect([open.mock.calls.length, fake.requests.length]).toEqual([0, 0]);
      expect(await writtenRows()).toEqual([0, 0]);
    });
  });

  it("AC11 (regression): the stream is opened by the shared SSE helper and carries the CH events", async () => {
    const { agent, channel, session } = await seed();
    fake.enqueue({ content: "none" }, { content: "Hello there", usage: { prompt_tokens: 10, completion_tokens: 5 } });
    const open = jest.spyOn(SseStream.prototype, "open");

    const res = await postChat(channel.id, agent.id, session);

    expect(open).toHaveBeenCalledTimes(1);
    expect([res.statusCode, res.contentType, res.ended]).toEqual([200, "text/event-stream", true]);
    expect(sseEvents(res.body)).toEqual([{ status: "understanding" }, { choices: [{ delta: { content: "Hello there" } }] }, { done: true }, "[DONE]"]);
  });

  it("AC12 and AC8: the client leaves while the run's first model call is running: the run has the helper's signal; no further model call, no answer stored (the user's message kept), the call that ran settled, the run's MCP connections closed once", async () => {
    const { user, agent, channel, session } = await seed();
    fake.enqueue({ content: "none" }, { toolCalls: [{ name: "step", arguments: {} }], usage: { prompt_tokens: 10, completion_tokens: 5 } }, { content: "Final answer" });
    const original = fake.chat.bind(fake);
    let release!: () => void;
    let arrive!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const isFirstCallRunning = new Promise<void>((resolve) => (arrive = resolve));
    jest.spyOn(fake, "chat").mockImplementation(async (request: ChatRequest) => {
      if (isClassifierCall(request)) return original(request);
      arrive();
      await gate;
      return original(request);
    });
    const open = jest.spyOn(SseStream.prototype, "open");
    const collect = jest.spyOn(ChatEngineService.prototype, "collect");
    const chat = jest.spyOn(moduleRef.get(ChannelChatService), "chat");
    if (!app.getHttpServer().listening) await app.listen(0, "127.0.0.1");
    const { port } = app.getHttpServer().address() as AddressInfo;
    const client = httpRequest({ host: "127.0.0.1", port, method: "POST", path: `/channels/${channel.id}/agents/${agent.id}/chat`, headers: { "content-type": "application/json", ...session } });
    client.on("error", () => undefined); // destroyed on purpose

    client.end(JSON.stringify({ message: "Hi" }));
    await isFirstCallRunning;
    client.destroy();
    const sse = open.mock.contexts[0] as SseStream;
    const isAborted = await isAbortedWithin(sse.signal);
    release();
    await (chat.mock.results[0].value as Promise<unknown>).catch(() => undefined);

    expect(isAborted).toBe(true);
    expect((collect.mock.calls[0][1] as ChatEngineRunOptions).signal).toBe(sse.signal);
    expect(fake.requests).toHaveLength(2); // the classifier and the run's first call; none after the client left
    expect(tools.executeTool).not.toHaveBeenCalled();
    expect((await prisma.channelMessage.findMany()).map((m) => [m.role, m.content])).toEqual([["user", "Hi"]]);
    const [reservation] = await prisma.creditReservation.findMany();
    expect([reservation.status, reservation.consumed.toFixed(6)]).toEqual(["settled", "0.000015"]);
    const account = await prisma.creditAccount.findUniqueOrThrow({ where: { userId_wallet: { userId: user.id, wallet: "paid" } } });
    expect([account.balance.toFixed(6), account.held.toFixed(6)]).toEqual(["0.999985", "0.000000"]);
    expect(tools.cleanupMcpConnections).toHaveBeenCalledTimes(1);
    expect(tools.cleanupMcpConnections.mock.calls[0][0]).toBe(tools.buildToolSchemasWithMcp.mock.calls[0][4].mcpSession);
    await assertCreditLedgerInvariants(prisma);
  }, 15000);
});
