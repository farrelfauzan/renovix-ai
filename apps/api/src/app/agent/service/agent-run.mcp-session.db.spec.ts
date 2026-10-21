import { TestingModule } from "@nestjs/testing";
import { Logger } from "@nestjs/common";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { AgentRunService } from "./agent-run.service";
import { AgentRunMeterService } from "./agent-run-meter.service";
import { AgentToolService } from "./agent-tool.service";
import { AgentMemoryService } from "./agent-memory.service";
import { ChannelChatService } from "../../channel/service/channel-chat.service";
import { ChannelService } from "../../channel/service/channel.service";
import { McpClientService } from "../../mcp/service/mcp-client.service";
import { McpService } from "../../mcp/service/mcp.service";
import { McpRegistryService } from "../../mcp/service/mcp-registry.service";
import { McpUserService } from "../../mcp/service/mcp-user.service";
import { WebSearchService } from "../../mcp/service/web-search.service";
import { DocumentService } from "../../document/service/document.service";
import { KnowledgeService } from "../../knowledge/service/knowledge.service";
import { WorkspaceKnowledgeService } from "../../workspace/service/workspace-knowledge.service";
import { UsageService } from "../../usage/service/usage.service";
import { GuardrailService } from "../../guardrail/service/guardrail.service";
import { ModelRegistryService } from "../../config/model-registry.service";
import { CreditService } from "../../billing/service/credit.service";
import { PlatformSettingsService } from "../../offers/service/platform-settings.service";
import { ProvidersModule } from "../../providers/providers.module";
import { PrismaService } from "../../prisma/prisma.service";
import type { FakeTurn } from "../../providers/fake.adapter";
import { createTestModule } from "../../../../test/test-module";
import { resetDatabase } from "../../../../test/test-database";
import { createAgent, createPlan, createSubscription, createUser, createWorkspace } from "../../../../test/factories";
import { FakeProviderAdapter, withFakeProvider } from "../../../../test/fake-provider";
import { createResolvableModel } from "../../../../test/provider-model";
import { fundPaidWallet } from "../../../../test/credit-funding";
import { setRunCap } from "../../../../test/run-cap";
import { captureLogLines } from "../../../../test/capture-log-lines";

// RNX-217: the MCP connections and the tool-name map belong to one run. Two runs that overlap (two users with the
// same provider connected, or one user twice) never share a connection or a tool mapping, and one run ending closes
// only its own connections. Real AgentRunService, ChannelChatService, AgentToolService and McpClientService on the
// test database, fake LLM provider. Each user's MCP provider is a local stub stdio server
// (apps/api/test/mcp-stub-server.mjs) that records who called it: McpService builds the real config (server id
// `${provider}-${userId}`), only its command is swapped for the stub. The modules mocked below load ESM-only packages.
jest.mock("../../mcp/service/mcp-user.service", () => ({ McpUserService: class {} }));
jest.mock("../../mcp/service/web-search.service", () => ({ WebSearchService: class {} }));
jest.mock("../../document/service/document.service", () => ({ DocumentService: class {} }));
jest.mock("../../knowledge/service/knowledge.service", () => ({ KnowledgeService: class {} }));
jest.mock("../../guardrail/service/guardrail.service", () => ({ GuardrailService: class {} }));

jest.setTimeout(30_000);

const STUB_SERVER = resolve(__dirname, "../../../../test/mcp-stub-server.mjs");
const MISSING_BINARY = "/nonexistent/rnx217-no-such-mcp-binary";
const PLANTED = "rnx217-planted-credential";

type StubRecord = { owner: string; pid: number; event: "started" | "call"; caller?: string };
type Runner = { name: string; userId: string; agentId: string; channelId: string };
type Gate = { arrived: Promise<void>; arrive: () => void; released: Promise<void>; release: () => void };
type Outcome = { error?: unknown };

describe("RNX-217: MCP connections and the tool map belong to one run (test database, stub MCP servers)", () => {
  const fake = new FakeProviderAdapter();
  /** Each user's connected providers, as McpUserService would decrypt them: the stub's env. */
  const connectedProviders = new Map<string, Map<string, Record<string, string>>>();
  let recordDir: string;
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let agentRuns: AgentRunService;
  let channelChats: ChannelChatService;

  beforeAll(async () => {
    ({ moduleRef, prisma } = await createTestModule(
      {
        imports: [ProvidersModule],
        providers: [
          AgentRunService,
          ChannelChatService,
          ChannelService,
          AgentToolService,
          McpClientService,
          McpService,
          McpRegistryService,
          AgentRunMeterService,
          CreditService,
          PlatformSettingsService,
          ModelRegistryService,
          UsageService,
          {
            provide: McpUserService,
            useValue: {
              getUserConnectedProviders: async (userId: string) => connectedProviders.get(userId) ?? new Map(),
            },
          },
          { provide: WebSearchService, useValue: {} },
          { provide: DocumentService, useValue: {} },
          {
            provide: AgentMemoryService,
            useValue: {
              getMemoryContext: async () => "",
              getWorkspaceMemoryContext: async () => "",
              extractAndStore: async () => undefined,
            },
          },
          { provide: KnowledgeService, useValue: {} },
          { provide: WorkspaceKnowledgeService, useValue: {} },
          {
            provide: GuardrailService,
            useValue: {
              checkInput: async () => ({ blocked: false }),
              checkOutput: async (content: string) => ({ blocked: false, content }),
            },
          },
        ],
      },
      (b) => withFakeProvider(b, fake),
    ));
    agentRuns = moduleRef.get(AgentRunService);
    channelChats = moduleRef.get(ChannelChatService);
  });

  beforeEach(async () => {
    await resetDatabase(prisma);
    fake.requests.length = 0;
    connectedProviders.clear();
    recordDir = mkdtempSync(join(tmpdir(), "rnx217-stub-records-"));
    await createResolvableModel(prisma, { slug: "test-model", modelName: "test-model", maxTokens: 8192 });
    await prisma.tierRate.create({
      data: { tier: "standard", inputCreditsPerToken: 1, cachedCreditsPerToken: 1, outputCreditsPerToken: 1 },
    });
    await moduleRef.get(ModelRegistryService).refresh();
    await setRunCap(prisma, 1);
    // The real config (id `${provider}-${userId}`, the user's env); only the command runs the local stub instead of
    // the provider's package (slack: a binary that does not exist, a provider that fails to connect).
    const mcpService = moduleRef.get(McpService);
    const buildConfig = mcpService.buildConfigFromProvider.bind(mcpService);
    jest.spyOn(mcpService, "buildConfigFromProvider").mockImplementation((provider, env, userId) => {
      const config = buildConfig(provider, env, userId);
      if (!config) return config;
      return provider === "slack"
        ? { ...config, command: MISSING_BINARY, args: [] }
        : { ...config, command: process.execPath, args: [STUB_SERVER] };
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
    rmSync(recordDir, { recursive: true, force: true });
  });

  afterAll(() => moduleRef?.close());

  const planted = (name: string) => `${PLANTED}-${name}`;

  /** A subscribed, funded user with a shared workspace (its channel), an agent in it, and "github" connected. */
  const seedUser = async (name: string): Promise<Runner> => {
    const user = await createUser(prisma);
    await createSubscription(prisma, { userId: user.id, planId: (await createPlan(prisma)).id });
    // 5 credits and a run cap of 1 (beforeEach): each run holds 1, so one user's two overlapping runs both start.
    await fundPaidWallet(prisma, user.id, "5");
    const channel = await prisma.channel.create({ data: { userId: user.id, name: `${name} room` } });
    const workspace = await createWorkspace(prisma, { ownerId: user.id, channelId: channel.id });
    const agent = await createAgent(prisma, { userId: user.id, workspaceId: workspace.id, status: "active" });
    await prisma.channelAgent.create({ data: { channelId: channel.id, agentId: agent.id } });
    const env = { MCP_STUB_OWNER: name, MCP_STUB_RECORD_FILE: join(recordDir, `${name}.jsonl`), MCP_STUB_TOKEN: planted(name) };
    connectedProviders.set(user.id, new Map([["github", env]]));
    return { name, userId: user.id, agentId: agent.id, channelId: channel.id };
  };

  const agentRun = (runner: Runner) => () => agentRuns.chat(runner.userId, runner.agentId, "Who answers?");
  const channelRun = (runner: Runner) => () =>
    channelChats.chat(runner.userId, runner.channelId, runner.agentId, "Who answers?");

  /** What the stub server of `name` recorded: its starts (one per connection) and the calls it answered. */
  const records = (name: string): StubRecord[] => {
    const file = join(recordDir, `${name}.jsonl`);
    if (!existsSync(file)) return [];
    return readFileSync(file, "utf8").trim().split("\n").map((line) => JSON.parse(line));
  };
  const callers = (name: string) => records(name).filter((r) => r.event === "call").map((r) => r.caller);

  /** The tool results the model was sent, in order, each once (a run keeps adding to the messages array it sent). */
  const toolResults = () => {
    const messages = fake.requests.flatMap((request) => request.messages as { role: string; content: unknown }[]);
    return [...new Set(messages)].filter((m) => m.role === "tool").map((m) => m.content);
  };

  const newGate = (): Gate => {
    const gate = {} as Gate;
    gate.arrived = new Promise<void>((resolve) => (gate.arrive = resolve));
    gate.released = new Promise<void>((resolve) => (gate.release = resolve));
    return gate;
  };

  /** Holds each run's tool call (told apart by its `caller` argument) until the test releases it. */
  const holdToolCalls = (callerNames: string[]): Map<string, Gate> => {
    const tools = moduleRef.get(AgentToolService);
    const execute = tools.executeTool.bind(tools);
    const gates = new Map(callerNames.map((caller) => [caller, newGate()]));
    jest.spyOn(tools, "executeTool").mockImplementation(async (...args: Parameters<typeof execute>) => {
      const gate = gates.get(args[1]?.caller);
      gate?.arrive();
      await gate?.released;
      return execute(...args);
    });
    return gates;
  };

  const whoami = (caller: string): FakeTurn => ({ toolCalls: [{ name: "whoami", arguments: { caller } }] });

  /**
   * Two overlapping runs: the first builds its tools and stops at its tool call; the second then builds its tools
   * (after the first's, before the first's tool call) and stops at its own tool call. The first's call goes on and
   * its run ends with `firstEnds`; then the second's call goes on and its run ends.
   */
  const overlap = async (first: () => Promise<unknown>, second: () => Promise<unknown>, firstEnds: FakeTurn) => {
    const gates = holdToolCalls(["first", "second"]);
    fake.enqueue(whoami("first"), whoami("second"), firstEnds, { content: "second done" });
    const settle = (run: Promise<unknown>): Promise<Outcome> => run.then(() => ({}), (error: unknown) => ({ error }));
    // A run that ends before its tool call (refused, failed) must not leave the test waiting at its hold.
    const firstRun = settle(first());
    await Promise.race([gates.get("first")?.arrived, firstRun]);
    const secondRun = settle(second());
    await Promise.race([gates.get("second")?.arrived, secondRun]);
    gates.get("first")?.release();
    const firstOutcome = await firstRun;
    gates.get("second")?.release();
    return { first: firstOutcome, second: await secondRun };
  };

  it("AC1 agent run vs agent run (two users, same provider): each tool call reaches only its own user's server", async () => {
    const [u1, u2] = [await seedUser("u1"), await seedUser("u2")];

    const outcome = await overlap(agentRun(u1), agentRun(u2), { content: "first done" });

    expect(outcome).toEqual({ first: {}, second: {} });
    expect({ u1: callers("u1"), u2: callers("u2") }).toEqual({ u1: ["first"], u2: ["second"] });
    expect(toolResults()).toEqual(["answered by u1", "answered by u2"]);
  });

  it("AC1 channel run (U1) vs agent run (U2): U1's channel tool call reaches only U1's server", async () => {
    const [u1, u2] = [await seedUser("u1"), await seedUser("u2")];

    const outcome = await overlap(channelRun(u1), agentRun(u2), { content: "first done" });

    expect(outcome).toEqual({ first: {}, second: {} });
    expect({ u1: callers("u1"), u2: callers("u2") }).toEqual({ u1: ["first"], u2: ["second"] });
    expect(toolResults()).toEqual(["answered by u1", "answered by u2"]);
  });

  it("AC1 agent run (U1) vs channel run (U2): U1's agent tool call reaches only U1's server", async () => {
    const [u1, u2] = [await seedUser("u1"), await seedUser("u2")];

    const outcome = await overlap(agentRun(u1), channelRun(u2), { content: "first done" });

    expect(outcome).toEqual({ first: {}, second: {} });
    expect({ u1: callers("u1"), u2: callers("u2") }).toEqual({ u1: ["first"], u2: ["second"] });
    expect(toolResults()).toEqual(["answered by u1", "answered by u2"]);
  });

  it("AC2 provider error: U1's run ends with a provider error; U2's connection stays open and its next tool call is answered", async () => {
    const [u1, u2] = [await seedUser("u1"), await seedUser("u2")];

    const outcome = await overlap(agentRun(u1), agentRun(u2), { error: { code: 502, message: "bad gateway" } });

    expect(outcome.first.error).toBeDefined();
    expect(outcome.second).toEqual({});
    expect({ u1: callers("u1"), u2: callers("u2") }).toEqual({ u1: ["first"], u2: ["second"] });
    expect(toolResults()).toEqual(["answered by u1", "answered by u2"]);
  });

  it("AC2 one user, two overlapping runs: each run its own connection (own process); the first ending leaves the second's open", async () => {
    const u1 = await seedUser("u1");

    const outcome = await overlap(agentRun(u1), agentRun(u1), { content: "first done" });

    expect(outcome).toEqual({ first: {}, second: {} });
    expect(callers("u1")).toEqual(["first", "second"]);
    const calls = records("u1").filter((r) => r.event === "call");
    const started = records("u1").filter((r) => r.event === "started");
    expect([new Set(started.map((r) => r.pid)).size, calls[0].pid !== calls[1].pid]).toEqual([2, true]);
    expect(toolResults()).toEqual(["answered by u1", "answered by u1"]);
  });

  it("AC5 a planted credential in a stub provider's config never appears in a log line (control: a line with it is captured)", async () => {
    const [u1, u2] = [await seedUser("u1"), await seedUser("u2")];
    // U1 also has a provider whose server fails to start, so the connect-failure log line is covered too.
    connectedProviders.get(u1.userId)?.set("slack", { SLACK_BOT_TOKEN: planted("u1-slack") });
    const { lines } = captureLogLines();

    const outcome = await overlap(channelRun(u1), agentRun(u2), { error: { code: 502, message: "bad gateway" } });
    new Logger("RNX-217 control").warn(`control ${planted("control")}`);

    expect(outcome.second).toEqual({});
    expect(lines.some((line) => line.includes("Failed to connect MCP provider slack"))).toBe(true);
    expect(lines.filter((line) => line.includes(PLANTED))).toEqual([`control ${planted("control")}`]);
  });
});
