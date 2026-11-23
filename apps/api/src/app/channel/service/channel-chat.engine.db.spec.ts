import { NotFoundException } from "@nestjs/common";
import { TestingModule } from "@nestjs/testing";
import { Decimal } from "@prisma/client/runtime/client";
import { ChannelChatService } from "./channel-chat.service";
import { ChannelService } from "./channel.service";
import { AgentRunService } from "../../agent/service/agent-run.service";
import { AgentToolService } from "../../agent/service/agent-tool.service";
import { AgentMemoryService } from "../../agent/service/agent-memory.service";
import { AgentRunMeterService } from "../../agent/service/agent-run-meter.service";
import { AgentLinkService } from "../../agent/service/agent-link.service";
import { AgentRunPolicyService } from "../../agent/service/agent-run-policy.service";
import { AgentRunRepository } from "../../agent/repository/agent-run.repository";
import { budgetStopMessage } from "../../agent/utils/budget-stop-message";
import { KnowledgeService } from "../../knowledge/service/knowledge.service";
import { WorkspaceKnowledgeService } from "../../workspace/service/workspace-knowledge.service";
import { WorkspaceQuotaService } from "../../workspace/service/workspace-quota.service";
import { UsageService } from "../../usage/service/usage.service";
import { GuardrailService } from "../../guardrail/service/guardrail.service";
import { ModelRegistryService } from "../../config/model-registry.service";
import { CreditService } from "../../billing/service/credit.service";
import { PlatformSettingsService } from "../../offers/service/platform-settings.service";
import { ProvidersModule } from "../../providers/providers.module";
import type { ChatRequest, ChatResponse } from "../../providers/provider.interface";
import { PrismaService } from "../../prisma/prisma.service";
import { CHANNEL_CHAT_MAX_STEPS_MESSAGE } from "../config/channel-chat-max-steps-message";
import { CHANNEL_CHAT_CONTINUE_PROMPT } from "../config/channel-chat-continue-prompt";
import { createTestModule } from "../../../../test/test-module";
import { resetDatabase } from "../../../../test/test-database";
import { createAgent, createPackageSnapshot, createUser, createWorkspace } from "../../../../test/factories";
import { FakeProviderAdapter, withFakeProvider } from "../../../../test/fake-provider";
import { createResolvableModel } from "../../../../test/provider-model";
import { fundPaidWallet } from "../../../../test/credit-funding";
import { setPeerRunLimits } from "../../../../test/peer-run-limits";
import { setRunCap } from "../../../../test/run-cap";
import { assertCreditLedgerInvariants } from "../../../../test/credit-ledger-invariants";

// RNX-24a: the channel chat (CH) on the chat engine (the `channel-chat` source). Real ChannelChatService (the adapter),
// ChannelService, run policy, links, AgentRunService (the agent's run list), memory (spied), meter and ledger on the
// test database; fake provider; the tool service, guardrail and knowledge services are stubs (they load ESM-only
// packages). The "AC2" block is the CH parity test: it gives the same result on main before this change.
jest.mock("../../agent/service/agent-tool.service", () => ({ AgentToolService: class {} }));
jest.mock("../../guardrail/service/guardrail.service", () => ({ GuardrailService: class {} }));
jest.mock("../../knowledge/service/knowledge.service", () => ({ KnowledgeService: class {} }));

const ECHO = { type: "function", function: { name: "echo", description: "Echo", parameters: {} } };
const CALL_AGENT = { type: "function", function: { name: "call_agent", description: "Call", parameters: {} } };
const notBlocked = async () => ({ blocked: false });
const passThrough = async (content: string) => ({ blocked: false, content });

describe("RNX-24a: channel chat on the chat engine (test database, fake provider)", () => {
  const fake = new FakeProviderAdapter();
  const tools = {
    buildToolSchemasWithMcp: jest.fn(async (..._args: unknown[]) => [ECHO] as unknown[]),
    executeTool: jest.fn(async (..._args: unknown[]) => "echo result"),
    cleanupMcpConnections: jest.fn(async (_session: unknown) => undefined),
  };
  const knowledge = { searchChunks: jest.fn() };
  const workspaceKnowledge = { canSearchKnowledgeBase: jest.fn(), searchKnowledgeBase: jest.fn() };
  const guardrail = { checkInput: jest.fn(notBlocked), checkOutput: jest.fn(passThrough) };
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let service: ChannelChatService;
  let memory: AgentMemoryService;

  beforeAll(async () => {
    ({ moduleRef, prisma } = await createTestModule(
      {
        imports: [ProvidersModule],
        providers: [
          ChannelChatService,
          ChannelService,
          AgentRunService,
          AgentRunPolicyService,
          AgentLinkService,
          AgentMemoryService,
          WorkspaceQuotaService,
          AgentRunMeterService,
          CreditService,
          PlatformSettingsService,
          ModelRegistryService,
          UsageService,
          { provide: AgentToolService, useValue: tools },
          { provide: KnowledgeService, useValue: knowledge },
          { provide: WorkspaceKnowledgeService, useValue: workspaceKnowledge },
          { provide: GuardrailService, useValue: guardrail },
        ],
      },
      (b) => withFakeProvider(b, fake),
    ));
    service = moduleRef.get(ChannelChatService);
    memory = moduleRef.get(AgentMemoryService);
  });

  beforeEach(async () => {
    await resetDatabase(prisma);
    fake.requests.length = 0;
    (fake as unknown as { turns: unknown[] }).turns.length = 0;
    for (const mock of [...Object.values(tools), knowledge.searchChunks, ...Object.values(workspaceKnowledge)]) mock.mockClear();
    tools.buildToolSchemasWithMcp.mockImplementation(async () => [ECHO]);
    tools.executeTool.mockImplementation(async () => "echo result");
    guardrail.checkInput.mockReset().mockImplementation(notBlocked);
    guardrail.checkOutput.mockReset().mockImplementation(passThrough);
    await createResolvableModel(prisma, { slug: "test-model", modelName: "test-model", maxTokens: 8192 });
    await prisma.tierRate.create({ data: { tier: "standard", inputCreditsPerToken: 1, cachedCreditsPerToken: 1, outputCreditsPerToken: 1 } });
    await moduleRef.get(ModelRegistryService).refresh();
  });

  afterEach(() => jest.restoreAllMocks());

  afterAll(() => moduleRef?.close());

  /** A subscribed user funded with `credits`. */
  const newUser = async (credits = "1") => {
    const user = await createUser(prisma);
    await createPackageSnapshot(prisma, { userId: user.id, collaborationEnabled: true });
    await fundPaidWallet(prisma, user.id, credits);
    return user;
  };

  /** The user's channel with the agent, and (when asked) the channel's own workspace W owned by `workspaceOwnerId`. */
  const channelWith = async (userId: string, agentId: string) => {
    const channel = await prisma.channel.create({ data: { userId, name: "Room" } });
    await prisma.channelAgent.create({ data: { channelId: channel.id, agentId } });
    return channel;
  };

  /** A runner with an agent (in the runner's default workspace) in their channel. */
  const seedPlain = async (credits = "1") => {
    const user = await newUser(credits);
    const agent = await createAgent(prisma, { userId: user.id, status: "active" });
    const channel = await channelWith(user.id, agent.id);
    return { user, agent, channel };
  };

  const storedMessages = async () => (await prisma.channelMessage.findMany({ orderBy: { createdAt: "asc" } })).map((m) => [m.role, m.content, m.tokens]);
  const usageEntries = () => prisma.creditLedgerEntry.findMany({ where: { type: "usage" }, orderBy: { seq: "asc" } });
  const toolNames = (i: number) => (fake.requests[i].tools ?? []).map((tool: { function: { name: string } }) => tool.function.name);
  const lastToolResults = () => fake.requests[fake.requests.length - 1].messages.filter((m: { role: string }) => m.role === "tool").map((m: { content?: unknown }) => m.content);
  const callAgent = (agent: string) => ({ toolCalls: [{ name: "call_agent", arguments: { agent, task: "do it" } }], usage: { prompt_tokens: 10, completion_tokens: 2 } });
  /** call_agent is offered as AgentToolService.buildToolSchemas offers it: only with `injectCallAgent`. */
  const offerCallAgentOnly = () =>
    tools.buildToolSchemasWithMcp.mockImplementation(async (...args: unknown[]) => ((args[4] as { injectCallAgent?: boolean }).injectCallAgent ? [CALL_AGENT] : []));
  /** The next provider answer is this raw response (the fake has no `length` finish or empty choices of its own). */
  const answerOnceWith = (response: Pick<ChatResponse, "choices">) =>
    jest.spyOn(fake, "chat").mockImplementationOnce(async (request: ChatRequest) => {
      fake.requests.push(request);
      return { id: "raw", model: request.model, usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 }, ...response } as ChatResponse;
    });

  describe("AC2: the CH loop's differences, as on main before this change", () => {
    it("30 rounds: after the 30th tool round no further model call; the CH max-steps text is stored with the rounds' tokens and not memorised", async () => {
      const { user, agent, channel } = await seedPlain();
      const extraction = jest.spyOn(memory, "extractAndStore");
      fake.enqueue(...Array.from({ length: 31 }, () => ({ toolCalls: [{ name: "echo", arguments: {} }], usage: { prompt_tokens: 1, completion_tokens: 1 } })));

      const actual = await service.chat(user.id, channel.id, agent.id, "Hi");

      expect(fake.requests).toHaveLength(30);
      expect([actual.content, actual.totalTokens]).toEqual([CHANNEL_CHAT_MAX_STEPS_MESSAGE, 60]);
      expect(await storedMessages()).toEqual([
        ["user", "Hi", null],
        ["assistant", CHANNEL_CHAT_MAX_STEPS_MESSAGE, 60],
      ]);
      expect(extraction).not.toHaveBeenCalled();
    });

    it("finish_reason length: the model is asked to continue and the parts are joined into one stored answer", async () => {
      const { user, agent, channel } = await seedPlain();
      answerOnceWith({ choices: [{ index: 0, message: { role: "assistant", content: "Part one, " }, finish_reason: "length" }] } as never);
      fake.enqueue({ content: "part two.", usage: { prompt_tokens: 20, completion_tokens: 5 } });

      const actual = await service.chat(user.id, channel.id, agent.id, "Hi");

      expect(actual.content).toBe("Part one, part two.");
      expect(fake.requests[1].messages.slice(-2)).toEqual([
        { role: "assistant", content: "Part one, " },
        { role: "user", content: CHANNEL_CHAT_CONTINUE_PROMPT },
      ]);
      expect(await storedMessages()).toEqual([
        ["user", "Hi", null],
        ["assistant", "Part one, part two.", 40],
      ]);
    });

    it("a tool result over 4,000 characters reaches the model cut to 4,000 plus the truncated mark", async () => {
      const { user, agent, channel } = await seedPlain();
      tools.executeTool.mockImplementation(async () => "x".repeat(4500));
      fake.enqueue({ toolCalls: [{ id: "call_1", name: "echo", arguments: {} }] }, { content: "Done" });

      await service.chat(user.id, channel.id, agent.id, "Hi");

      expect(fake.requests[1].messages.at(-1)).toEqual({ role: "tool", tool_call_id: "call_1", content: `${"x".repeat(4000)}\n...[truncated]` });
    });

    it("a response without a choice ends the loop: the max-steps text is stored with the call's tokens, no further call, not memorised", async () => {
      const { user, agent, channel } = await seedPlain();
      const extraction = jest.spyOn(memory, "extractAndStore");
      answerOnceWith({ choices: [] });

      const actual = await service.chat(user.id, channel.id, agent.id, "Hi");

      expect([actual.content, actual.totalTokens, fake.requests.length]).toEqual([CHANNEL_CHAT_MAX_STEPS_MESSAGE, 15, 1]);
      expect(await storedMessages()).toEqual([
        ["user", "Hi", null],
        ["assistant", CHANNEL_CHAT_MAX_STEPS_MESSAGE, 15],
      ]);
      expect(extraction).not.toHaveBeenCalled();
    });
  });

  /** Bob's workspace W with agents A (public when asked) and B ("Bob helper"), A -> B; W is the channel's own workspace when `isRoomWorkspace`. */
  const seedLinked = async ({ isPublic = false } = {}) => {
    const bob = await newUser();
    const workspace = await createWorkspace(prisma, { ownerId: bob.id });
    const a = await createAgent(prisma, { userId: bob.id, workspaceId: workspace.id, status: "active", isPublic });
    const b = await createAgent(prisma, { userId: bob.id, workspaceId: workspace.id, name: "Bob helper", systemPrompt: "CALLEE B PROMPT", status: "active" });
    await prisma.agentLink.create({ data: { callerAgentId: a.id, calleeAgentId: b.id } });
    await setPeerRunLimits(prisma, { maxDepth: 2, maxAgentCalls: 3, callTimeoutSeconds: 30 });
    offerCallAgentOnly();
    return { bob, workspace, a, b };
  };

  it("AC3 and AC16: A -> B in the room's workspace, the owner's message: B runs through RNX-121's agent-call step (its own prompt, only its task, metered under A's call), A answers; one top-level channel run row, B's child row under it, and neither run list shows it", async () => {
    const { bob, workspace, a, b } = await seedLinked();
    const channel = await channelWith(bob.id, a.id);
    await prisma.workspace.update({ where: { id: workspace.id }, data: { channelId: channel.id } });
    fake.enqueue(callAgent(b.name), { content: "B answer", usage: { prompt_tokens: 7, completion_tokens: 3 } }, { content: "A final", usage: { prompt_tokens: 12, completion_tokens: 4 } });

    const actual = await service.chat(bob.id, channel.id, a.id, "Hi");

    expect(actual.content).toBe("A final");
    expect(toolNames(0)).toEqual(["call_agent"]);
    expect(fake.requests[1].messages[0].content).toContain("CALLEE B PROMPT");
    expect(fake.requests[1].messages.slice(1)).toEqual([{ role: "user", content: `Task from agent "${a.name}": do it` }]);
    expect(lastToolResults()).toEqual(["B answer"]);
    const entries = await usageEntries();
    expect(entries.map((e) => [e.agentId, e.parentCallId])).toEqual([
      [a.id, null],
      [b.id, entries[0].callId],
      [a.id, null],
    ]);
    const runs = await prisma.agentRun.findMany({ orderBy: { depth: "asc" } });
    expect(runs.map((r) => [r.agentId, r.userId, r.parentRunId, r.depth, r.channelType])).toEqual([
      [a.id, bob.id, null, 0, "channel"],
      [b.id, bob.id, runs[0].id, 1, "channel"],
    ]);
    expect([runs[1].status, runs[1].parentCallId]).toEqual(["completed", entries[0].callId]);
    const agentRuns = moduleRef.get(AgentRunService);
    expect([await agentRuns.listRuns(bob.id, a.id), await agentRuns.listRuns(bob.id, b.id)]).toEqual([[], []]);
    expect(await moduleRef.get(AgentRunRepository).findActiveRun(a.id, bob.id, runs[0].sessionId)).toBeNull();
    await assertCreditLedgerInvariants(prisma);
  });

  it("AC16 (control): a channel run without an agent call writes no agent_runs row", async () => {
    const { user, agent, channel } = await seedPlain();
    fake.enqueue({ content: "Hello" });

    await service.chat(user.id, channel.id, agent.id, "Hi");

    expect(await prisma.agentRun.count()).toBe(0);
  });

  it("AC4 (negative): an outsider runs Bob's public A in their room: no call_agent offered, no agent listed, none of the home workspace's memory or knowledge used, and a call to B never runs (no child run)", async () => {
    const { workspace, a, b } = await seedLinked({ isPublic: true });
    await prisma.workspaceMemory.create({ data: { workspaceId: workspace.id, type: "fact", content: "HOME WORKSPACE SECRET" } });
    const base = await prisma.knowledgeBase.create({ data: { workspaceId: workspace.id, name: "Home base" } });
    await prisma.agentKnowledgeBase.create({ data: { agentId: a.id, knowledgeBaseId: base.id } });
    const carol = await newUser();
    const channel = await channelWith(carol.id, a.id);
    fake.enqueue(callAgent(b.id), { content: "Done" });

    await service.chat(carol.id, channel.id, a.id, "Hi");

    expect(toolNames(0)).toEqual([]);
    expect(fake.requests[0].messages[0].content).not.toContain(b.id);
    expect(fake.requests[0].messages[0].content).not.toContain("Callable Agents");
    expect(JSON.stringify(fake.requests)).not.toContain("HOME WORKSPACE SECRET");
    expect(JSON.stringify(fake.requests)).not.toContain("CALLEE B PROMPT");
    expect(fake.requests).toHaveLength(2);
    expect(lastToolResults()).toEqual(["Error: Agent not found or not linked."]);
    expect([workspaceKnowledge.canSearchKnowledgeBase.mock.calls.length, workspaceKnowledge.searchKnowledgeBase.mock.calls.length, knowledge.searchChunks.mock.calls.length]).toEqual([0, 0, 0]);
    expect(await prisma.agentRun.count()).toBe(0);
  });

  describe("AC5 (negative): nothing is reserved, called or stored", () => {
    it("RNX-124: a deleted agent in the room: 404 'Agent not in this channel'", async () => {
      const { user, agent, channel } = await seedPlain();
      await prisma.agent.updateMany({ where: { id: agent.id }, data: { deletedAt: new Date(), deletedById: user.id } });

      await expect(service.chat(user.id, channel.id, agent.id, "Hi")).rejects.toThrow(new NotFoundException("Agent not in this channel"));

      expect([fake.requests.length, await prisma.creditReservation.count(), await prisma.channelMessage.count()]).toEqual([0, 0, 0]);
    });

    it("RNX-145: the channel's workspace was deleted: 404 'Channel not found'", async () => {
      const { user, agent, channel } = await seedPlain();
      await createWorkspace(prisma, { ownerId: user.id, channelId: channel.id, deletedAt: new Date() });

      await expect(service.chat(user.id, channel.id, agent.id, "Hi")).rejects.toThrow(new NotFoundException("Channel not found"));

      expect([fake.requests.length, await prisma.creditReservation.count(), await prisma.channelMessage.count()]).toEqual([0, 0, 0]);
    });
  });

  describe("AC7: the memory extraction (RNX-284's path)", () => {
    it("an approved, saved answer: extraction starts once, with the channel id, and the reply does not wait for it", async () => {
      const { user, agent, channel } = await seedPlain();
      const extraction = jest.spyOn(memory, "extractAndStore").mockImplementation(() => new Promise<void>(() => undefined));
      fake.enqueue({ content: "Hello" });

      const actual = await service.chat(user.id, channel.id, agent.id, "I like Rust");

      expect(actual.content).toBe("Hello");
      expect(extraction.mock.calls).toEqual([[agent.id, user.id, "I like Rust", "Hello", "inside", channel.id]]);
    });

    it("a blocked answer: no extraction", async () => {
      const { user, agent, channel } = await seedPlain();
      const extraction = jest.spyOn(memory, "extractAndStore").mockImplementation(async () => undefined);
      guardrail.checkOutput.mockImplementation(async () => ({ blocked: true, sanitized: "SANITIZED", content: "" }) as never);
      fake.enqueue({ content: "RAW" });

      const actual = await service.chat(user.id, channel.id, agent.id, "Hi");

      expect(actual.content).toBe("SANITIZED");
      expect(extraction).not.toHaveBeenCalled();
    });
  });

  describe("AC8: the room's workspace W for the MCP tools; the run's own connections closed exactly once", () => {
    /** A runner whose agent is in their default workspace, in a channel whose workspace is W (also the runner's). */
    const seedRoomWorkspace = async (credits = "1") => {
      const seeded = await seedPlain(credits);
      const roomWorkspace = await createWorkspace(prisma, { ownerId: seeded.user.id, channelId: seeded.channel.id });
      return { ...seeded, roomWorkspace };
    };

    /** The tools were built once, for W, into a session that was closed exactly once. */
    const expectRoomToolsClosedOnce = (roomWorkspaceId: string, agentWorkspaceId: string) => {
      const [buildCall] = tools.buildToolSchemasWithMcp.mock.calls;
      expect(roomWorkspaceId).not.toBe(agentWorkspaceId);
      expect([tools.buildToolSchemasWithMcp.mock.calls.length, buildCall[3], tools.cleanupMcpConnections.mock.calls.length]).toEqual([1, roomWorkspaceId, 1]);
      expect(tools.cleanupMcpConnections.mock.calls[0][0]).toBe((buildCall[4] as { mcpSession: unknown }).mcpSession);
    };

    it("success: the room's workspace, closed once; a tool call gets the channel id", async () => {
      const { user, agent, channel, roomWorkspace } = await seedRoomWorkspace();
      fake.enqueue({ toolCalls: [{ name: "echo", arguments: {} }] }, { content: "Hello" });

      expect((await service.chat(user.id, channel.id, agent.id, "Hi")).content).toBe("Hello");

      expectRoomToolsClosedOnce(roomWorkspace.id, agent.workspaceId);
      expect(tools.executeTool.mock.calls[0][6]).toBe(channel.id);
    });

    it("refusal (the first call over the per-run cap): 402 RUN_CAP_EXCEEDED, closed once", async () => {
      const { user, agent, channel, roomWorkspace } = await seedRoomWorkspace();
      await setRunCap(prisma, 0.001);

      await expect(service.chat(user.id, channel.id, agent.id, "Hi")).rejects.toMatchObject({ status: 402, response: { code: "RUN_CAP_EXCEEDED" } });

      expectRoomToolsClosedOnce(roomWorkspace.id, agent.workspaceId);
    });

    it("provider error: rethrown, closed once", async () => {
      const { user, agent, channel, roomWorkspace } = await seedRoomWorkspace();
      fake.enqueue({ error: { code: 502, message: "bad gateway" } });

      await expect(service.chat(user.id, channel.id, agent.id, "Hi")).rejects.toThrow();

      expectRoomToolsClosedOnce(roomWorkspace.id, agent.workspaceId);
    });

    it("budget stop: the stop message, closed once", async () => {
      const { user, agent, channel, roomWorkspace } = await seedRoomWorkspace();
      await setRunCap(prisma, 0.01);
      fake.enqueue({ toolCalls: [{ name: "echo", arguments: {} }], usage: { prompt_tokens: 9_900, completion_tokens: 10 } });

      expect((await service.chat(user.id, channel.id, agent.id, "Hi")).content).toBe(budgetStopMessage(new Decimal("0.01")));

      expectRoomToolsClosedOnce(roomWorkspace.id, agent.workspaceId);
    });
  });
});
