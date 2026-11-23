import { TestingModule } from "@nestjs/testing";
import { NestFastifyApplication } from "@nestjs/platform-fastify";
import { Socket } from "node:net";
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
import { RunLimitStoppedError } from "../../agent/errors/run-limit-stopped.error";
import { budgetStopMessage } from "../../agent/utils/budget-stop-message";
import { rememberOfferedTools } from "../../agent/utils/remember-offered-tools";
import type { McpRunSession } from "../../agent/types/mcp-run-session";
import type { ToolSchema } from "../../agent/types/tool-schema";
import { WorkspaceQuotaService } from "../../workspace/service/workspace-quota.service";
import { UsageService } from "../../usage/service/usage.service";
import { GuardrailService } from "../../guardrail/service/guardrail.service";
import { ModelRegistryService } from "../../config/model-registry.service";
import { CreditService } from "../../billing/service/credit.service";
import { PlatformSettingsService } from "../../offers/service/platform-settings.service";
import { ProvidersModule } from "../../providers/providers.module";
import type { ChatRequest, ChatResponse } from "../../providers/provider.interface";
import { PrismaService } from "../../prisma/prisma.service";
import { SseStream } from "../../../common/utils/sse-stream";
import { SSE_HEARTBEAT_INTERVAL_MS } from "../../../common/config/sse-heartbeat-interval-ms";
import { createFastifyApp, createTestModule } from "../../../../test/test-module";
import { resetDatabase } from "../../../../test/test-database";
import { createAgent, createPackageSnapshot, createUser } from "../../../../test/factories";
import { FakeProviderAdapter, withFakeProvider } from "../../../../test/fake-provider";
import { createResolvableModel } from "../../../../test/provider-model";
import { fundPaidWallet } from "../../../../test/credit-funding";
import { setPeerRunLimits } from "../../../../test/peer-run-limits";
import { assertCreditLedgerInvariants } from "../../../../test/credit-ledger-invariants";
import { requestOverSocket, sseEvents } from "../../../../test/sse-client";
import { asSessionUser } from "../../../../test/as-session-user";

// RNX-351: RNX-326's run limits on POST /channels/:id/agents/:agentId/chat (the channel chat on the engine). AC1: a
// channel run with agent calls whose stream the SSE heartbeat keeps alive stops at the smaller of peerRunMaxMinutes and
// the channel's own run time limit (CHANNEL_RUN_TIME_LIMIT_MS, small test values through the mocked config), not at
// anything derived from the route's 180 s socket timeout (D383), with the approved budget-stop answer; and the
// model-call cap (peerRunMaxModelCalls) stops it too. Real ChannelController, ChannelChatService, meter and ledger on
// the test database; fake provider (the first call is the document-intent classifier's). Fake timers: the run's stop
// timer is caught (not scheduled) and fired by the test while B's model call runs, after the shortened heartbeat has
// written twice, so nothing really waits. The tool service, guardrail, memory and knowledge are stubs (ESM-only packages).
jest.mock("../../knowledge/service/s3.service", () => ({ S3Service: class {} }));
jest.mock("../../knowledge/service/knowledge.service", () => ({ KnowledgeService: class {} }));
jest.mock("../../document/service/document.service", () => ({ DocumentService: class {} }));
jest.mock("../../agent/service/agent-tool.service", () => ({ AgentToolService: class {} }));
jest.mock("../../guardrail/service/guardrail.service", () => ({ GuardrailService: class {} }));
const mockChannelRunLimit = { ms: 0 };
jest.mock("../config/channel-run-time-limit-ms", () => ({
  get CHANNEL_RUN_TIME_LIMIT_MS() {
    return mockChannelRunLimit.ms;
  },
}));

type CaughtTimer = { readonly delayMs: number; readonly fire: () => void };

const STEP_SCHEMA = { type: "function", function: { name: "step", description: "step", parameters: { type: "object", properties: {} } } } as ToolSchema;
const CALL_AGENT_SCHEMA = { type: "function", function: { name: "call_agent", description: "call", parameters: { type: "object", properties: {} } } } as ToolSchema;
/** The route's socket timeout (channel.controller.ts), an idle timeout the heartbeat resets. */
const ROUTE_SOCKET_TIMEOUT_MS = 180_000;
/** How far below the expected run time limit the caught timer's delay may be (the time from the run's start to its first agent call). */
const TIMER_SLACK_MS = 5_000;
/** A stalled model call that is never aborted (a planted fault) answers its next scripted turn after this long, so the test fails on an assertion, not on Jest's timeout. */
const GUARD_MS = 2_000;
/** The shortened heartbeat interval: the stream gets heartbeats while B's call runs. */
const TEST_HEARTBEAT_MS = 20;
/** The heartbeats written before the test fires the run's stop timer. */
const HEARTBEATS_BEFORE_STOP = 2;
/** The document-intent classifier's call (its fixed max_tokens). */
const isClassifierCall = (request: ChatRequest) => request.max_tokens === 200;

describe("RNX-351: the run limits of a channel run with agent calls (Fastify, test database, fake provider)", () => {
  const fake = new FakeProviderAdapter();
  const chat = fake.chat.bind(fake);
  const tools = {
    buildToolSchemasWithMcp: jest.fn(async (_tools: unknown, _agentId: string, _userId: string, _workspaceId: string, options: { injectCallAgent?: boolean; mcpSession: McpRunSession }) => {
      const schemas = [STEP_SCHEMA, ...(options.injectCallAgent ? [CALL_AGENT_SCHEMA] : [])];
      rememberOfferedTools(options.mcpSession, schemas);
      return schemas;
    }),
    executeTool: jest.fn(async () => "stepped"),
    cleanupMcpConnections: jest.fn(async (_session: unknown) => undefined),
  };
  const checkOutput = jest.fn(async (content: string) => ({ blocked: false, content }));
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
          { provide: AgentMemoryService, useValue: { getWorkspaceMemoryContext: async () => "", getMemoryContext: async () => "", extractAndStore: async () => undefined } },
          { provide: KnowledgeService, useValue: {} },
          { provide: WorkspaceKnowledgeService, useValue: {} },
          { provide: GuardrailService, useValue: { checkInput: async () => ({ blocked: false }), checkOutput } },
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
    jest.clearAllMocks();
    await createResolvableModel(prisma, { slug: "test-model", modelName: "test-model", maxTokens: 8192 });
    // Standard 1 / 1 / 1: a call costs its token count in micro-credits.
    await prisma.tierRate.create({ data: { tier: "standard", inputCreditsPerToken: 1, cachedCreditsPerToken: 1, outputCreditsPerToken: 1 } });
    await moduleRef.get(ModelRegistryService).refresh();
  });

  afterEach(() => jest.restoreAllMocks());

  afterAll(async () => {
    await app?.close();
  });

  /** A subscribed user funded with 1 credit, agents A and B ("PROMPT A", "PROMPT B"; A may call B), A in their channel, and a session cookie. */
  const seed = async () => {
    const user = await createUser(prisma);
    await createPackageSnapshot(prisma, { userId: user.id });
    await fundPaidWallet(prisma, user.id, "1");
    const A = await createAgent(prisma, { userId: user.id, name: "Agent A", systemPrompt: "PROMPT A", status: "active", maxTokens: 100 });
    const B = await createAgent(prisma, { userId: user.id, name: "Agent B", systemPrompt: "PROMPT B", status: "active", maxTokens: 100 });
    await prisma.agentLink.create({ data: { callerAgentId: A.id, calleeAgentId: B.id } });
    const channel = await prisma.channel.create({ data: { userId: user.id, name: "Room" } });
    await prisma.channelAgent.create({ data: { channelId: channel.id, agentId: A.id } });
    return { A, B, channel, session: asSessionUser(user) };
  };

  const postChat = (channelId: string, agentId: string, session: { cookie: string }) =>
    requestOverSocket(app, { method: "POST", path: `/channels/${channelId}/agents/${agentId}/chat`, headers: session, body: { message: "Hi" } });

  const usage = { prompt_tokens: 10, completion_tokens: 5 };
  const call = (agent: string, task: string) => ({ toolCalls: [{ name: "call_agent", arguments: { agent, task } }], usage });
  const step = () => ({ toolCalls: [{ name: "step", arguments: {} }], usage });
  const answer = (content: string) => ({ content, usage });
  /** Which agent a request is from: its prompt names it (none for the classifier). */
  const agentOf = (request: ChatRequest) => /PROMPT (\w)/.exec(String(request.messages[0].content))?.[1];
  const runRequests = () => fake.requests.filter((request) => !isClassifierCall(request)).map(agentOf);
  const hops = () => prisma.agentRun.findMany({ where: { parentRunId: { not: null } }, orderBy: [{ depth: "asc" }, { createdAt: "asc" }] });
  const storedMessages = async () => (await prisma.channelMessage.findMany({ orderBy: { createdAt: "asc" } })).map((m) => [m.role, m.content]);
  const usageEntries = async () =>
    (await prisma.creditLedgerEntry.findMany({ where: { type: "usage" }, orderBy: { seq: "asc" } })).map((e) => [e.agentId, e.outcome, e.amount.toFixed(6)]);
  const stopAnswerEvents = (held: Parameters<typeof budgetStopMessage>[0]) => [{ choices: [{ delta: { content: budgetStopMessage(held) } }] }, { done: true }, "[DONE]"];

  /**
   * The run's stop timer: a `setTimeout` whose delay is at most `limitMs` and within TIMER_SLACK_MS of it is caught
   * (not scheduled) and fired by the test; every other timer runs as usual.
   */
  const catchRunTimer = (limitMs: number): CaughtTimer[] => {
    const realSetTimeout = globalThis.setTimeout as unknown as (callback: (...args: unknown[]) => void, delayMs?: number, ...args: unknown[]) => unknown;
    const caught: CaughtTimer[] = [];
    jest.spyOn(globalThis, "setTimeout").mockImplementation(((callback: () => void, delayMs?: number, ...args: unknown[]) => {
      if (delayMs === undefined || delayMs <= limitMs - TIMER_SLACK_MS || delayMs > limitMs) return realSetTimeout(callback, delayMs, ...args);
      caught.push({ delayMs, fire: callback });
      return undefined;
    }) as unknown as typeof setTimeout);
    return caught;
  };

  /** The SSE heartbeat every TEST_HEARTBEAT_MS instead of every 15 s; every other interval runs as usual. */
  const shortenHeartbeat = (): void => {
    const realSetInterval = globalThis.setInterval as unknown as (callback: (...args: unknown[]) => void, delayMs?: number, ...args: unknown[]) => unknown;
    jest.spyOn(globalThis, "setInterval").mockImplementation(((callback: () => void, delayMs?: number, ...args: unknown[]) =>
      realSetInterval(callback, delayMs === SSE_HEARTBEAT_INTERVAL_MS ? TEST_HEARTBEAT_MS : delayMs, ...args)) as unknown as typeof setInterval);
  };

  /** Resolves once the stream has written `count` heartbeats (polled on the heartbeat's own interval). */
  const waitForHeartbeats = async (heartbeats: jest.SpyInstance, count: number): Promise<void> => {
    while (heartbeats.mock.calls.filter(([text]) => text === "heartbeat").length < count) await new Promise((resolve) => setTimeout(resolve, TEST_HEARTBEAT_MS));
  };

  /**
   * A model call that ends only when its signal aborts (it rejects with the abort's reason, as the adapter's fetch does);
   * `onStart` runs once it listens. Never aborted (a planted fault), it answers its next scripted turn after GUARD_MS.
   */
  const stall = (request: ChatRequest, onStart: () => void): Promise<ChatResponse> =>
    new Promise((resolve, reject) => {
      const guard = setTimeout(() => resolve(chat(request)), GUARD_MS);
      request.signal?.addEventListener("abort", () => {
        clearTimeout(guard);
        reject(request.signal?.reason);
      }, { once: true });
      onStart();
    });

  describe("AC1: the run time limit, the smaller of peerRunMaxMinutes and the channel's own limit (CHANNEL_RUN_TIME_LIMIT_MS)", () => {
    it.each([
      ["the channel limit smaller: 90 s < peerRunMaxMinutes 2", 90_000, 2, 90_000],
      ["peerRunMaxMinutes smaller: 2 min < the channel limit 150 s", 150_000, 2, 120_000],
      ["the channel limit above the route's 180 s socket timeout: 240 s < peerRunMaxMinutes 5, not cut at the socket timeout (nor at it minus the margin)", 240_000, 5, 240_000],
    ])("%s: the stop timer is set at that limit after the run's start; it fires while B's model call runs and heartbeats keep the stream alive: that call is aborted, no further call starts, B's child run is timeout, and the run ends with the approved budget-stop answer, stored, as limit_stopped (settled)", async (_case, channelLimitMs, maxMinutes, expectedLimitMs) => {
      mockChannelRunLimit.ms = channelLimitMs;
      await setPeerRunLimits(prisma, { maxDepth: 1, maxAgentCalls: 3, callTimeoutSeconds: 30, maxModelCalls: 10, maxMinutes });
      const { A, B, channel, session } = await seed();
      const runTimers = catchRunTimer(expectedLimitMs);
      shortenHeartbeat();
      const heartbeats = jest.spyOn(SseStream.prototype, "writeComment");
      const socketTimeouts = jest.spyOn(Socket.prototype, "setTimeout");
      const stalled: ChatRequest[] = [];
      jest.spyOn(fake, "chat").mockImplementation((request: ChatRequest) => {
        if (agentOf(request) !== "B") return chat(request);
        stalled.push(request);
        return stall(request, () => void waitForHeartbeats(heartbeats, HEARTBEATS_BEFORE_STOP).then(() => runTimers[0]?.fire()));
      });
      const closeRun = jest.spyOn(moduleRef.get(AgentRunMeterService), "closeRun");
      fake.enqueue(answer("none"), call("Agent B", "slow work"), answer("B too late"), answer("A goes on"));

      const res = await postChat(channel.id, A.id, session);

      const [reservation] = await prisma.creditReservation.findMany();
      const events = sseEvents(res.body);
      expect(socketTimeouts.mock.calls.map(([ms]) => ms)).toContain(ROUTE_SOCKET_TIMEOUT_MS);
      expect(runTimers).toHaveLength(1);
      expect(runTimers[0].delayMs).toBeLessThanOrEqual(expectedLimitMs);
      expect(events.filter((event) => event === ": heartbeat").length).toBeGreaterThanOrEqual(HEARTBEATS_BEFORE_STOP);
      expect(events.slice(-3)).toEqual(stopAnswerEvents(reservation.amountHeld));
      expect(checkOutput).toHaveBeenLastCalledWith(budgetStopMessage(reservation.amountHeld), expect.anything(), A.id);
      expect(runRequests()).toEqual(["A"]);
      expect(stalled.map(agentOf)).toEqual(["B"]);
      expect(stalled[0].signal?.aborted).toBe(true);
      expect(stalled[0].signal?.reason).toBeInstanceOf(RunLimitStoppedError);
      expect((await hops()).map((h) => [h.agentId, h.depth, h.status])).toEqual([[B.id, 1, "timeout"]]);
      expect(await usageEntries()).toEqual([
        [A.id, "completed", "-0.000015"],
        [B.id, "provider_error", "0.000000"],
      ]);
      expect(reservation.status).toBe("settled");
      expect(closeRun.mock.calls.map(([, ending]) => ending)).toEqual(["limit_stopped"]);
      expect(await storedMessages()).toEqual([
        ["user", "Hi"],
        ["assistant", budgetStopMessage(reservation.amountHeld)],
      ]);
      await assertCreditLedgerInvariants(prisma);
    });
  });

  describe("the model-call cap (peerRunMaxModelCalls)", () => {
    it("peerRunMaxModelCalls 3 and A -> B, where A's call and B's two calls reach it: A's next model call is not made, the run ends with the approved budget-stop answer, stored, as limit_stopped; the ledger has exactly the 3 calls and the reservation is settled", async () => {
      mockChannelRunLimit.ms = 300_000;
      await setPeerRunLimits(prisma, { maxDepth: 1, maxAgentCalls: 3, callTimeoutSeconds: 30, maxModelCalls: 3, maxMinutes: 2 });
      const { A, B, channel, session } = await seed();
      const closeRun = jest.spyOn(moduleRef.get(AgentRunMeterService), "closeRun");
      fake.enqueue(answer("none"), call("Agent B", "add it up"), step(), answer("B answer"), answer("A final"));

      const res = await postChat(channel.id, A.id, session);

      const [reservation] = await prisma.creditReservation.findMany();
      expect(sseEvents(res.body).slice(-3)).toEqual(stopAnswerEvents(reservation.amountHeld));
      expect(checkOutput).toHaveBeenLastCalledWith(budgetStopMessage(reservation.amountHeld), expect.anything(), A.id);
      expect(runRequests()).toEqual(["A", "B", "B"]);
      expect(await usageEntries()).toEqual([
        [A.id, "completed", "-0.000015"],
        [B.id, "completed", "-0.000015"],
        [B.id, "completed", "-0.000015"],
      ]);
      expect([reservation.status, reservation.consumed.toFixed(6)]).toEqual(["settled", "0.000045"]);
      expect(closeRun.mock.calls.map(([, ending]) => ending)).toEqual(["limit_stopped"]);
      expect((await hops()).map((h) => [h.agentId, h.depth, h.status])).toEqual([[B.id, 1, "completed"]]);
      expect(await storedMessages()).toEqual([
        ["user", "Hi"],
        ["assistant", budgetStopMessage(reservation.amountHeld)],
      ]);
      await assertCreditLedgerInvariants(prisma);
    });
  });
});
