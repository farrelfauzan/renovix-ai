import { NotFoundException } from "@nestjs/common";
import { TestingModule } from "@nestjs/testing";
import { AgentRunService } from "./agent-run.service";
import { AgentRunPolicyService } from "./agent-run-policy.service";
import { AgentLinkService } from "./agent-link.service";
import { AgentMemoryService } from "./agent-memory.service";
import { AgentRunMeterService } from "./agent-run-meter.service";
import { AgentToolService } from "./agent-tool.service";
import { ChannelChatService } from "../../channel/service/channel-chat.service";
import { ChannelService } from "../../channel/service/channel.service";
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
import { createTestModule } from "../../../../test/test-module";
import { resetDatabase } from "../../../../test/test-database";
import { createAgent, createPackageSnapshot, createUser, createWorkspace } from "../../../../test/factories";
import { FakeProviderAdapter, withFakeProvider } from "../../../../test/fake-provider";
import { createResolvableModel } from "../../../../test/provider-model";
import { fundPaidWallet } from "../../../../test/credit-funding";
import { assertCreditLedgerInvariants } from "../../../../test/credit-ledger-invariants";

// RNX-284: the two existing callers of the automatic memory extraction, the agent chat (AgentRunService.chat) and the
// channel chat (ChannelChatService.chat), on the one corrected path. The extraction starts only for an approved,
// saved answer of a run inside the workspace, once the chat's reservation is closed; the chat never waits for it; it
// runs once, as its own metered run; and a failure of it never changes the chat. Real services, meter, CreditService
// and UsageService on the test database; fake provider. These collaborators load ESM-only packages and are stubbed.
jest.mock("./agent-tool.service", () => ({ AgentToolService: class {} }));
jest.mock("../../knowledge/service/knowledge.service", () => ({ KnowledgeService: class {} }));
jest.mock("../../guardrail/service/guardrail.service", () => ({ GuardrailService: class {} }));

const EXTRACTION_SYSTEM_PROMPT = "You extract user facts from conversations. Respond only with valid JSON.";
const FACT = { type: "interest", content: "Likes Rust", confidence: 0.8 };
/** How long the chat may take while its extraction call is held; a chat that waits for the extraction exceeds it. */
const CHAT_BOUND_MS = 10000;

type Mode = "agent chat" | "channel chat";
const MODES: readonly Mode[] = ["agent chat", "channel chat"];

describe("RNX-284: the extraction's callers, agent chat and channel chat (test database, fake provider)", () => {
  const fake = new FakeProviderAdapter();
  const passThrough = async (content: string) => ({ blocked: false, content });
  const mockCheckOutput = jest.fn(passThrough);
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let agentRuns: AgentRunService;
  let channelChats: ChannelChatService;
  let channels: ChannelService;
  let memory: AgentMemoryService;

  beforeAll(async () => {
    ({ moduleRef, prisma } = await createTestModule(
      {
        imports: [ProvidersModule],
        providers: [
          AgentRunService,
          ChannelChatService,
          ChannelService,
          AgentRunPolicyService,
          AgentLinkService,
          AgentMemoryService,
          WorkspaceQuotaService,
          AgentRunMeterService,
          CreditService,
          PlatformSettingsService,
          ModelRegistryService,
          UsageService,
          { provide: AgentToolService, useValue: { buildToolSchemasWithMcp: async () => [], cleanupMcpConnections: async () => undefined } },
          { provide: KnowledgeService, useValue: {} },
          { provide: WorkspaceKnowledgeService, useValue: {} },
          { provide: GuardrailService, useValue: { checkInput: async () => ({ blocked: false }), checkOutput: mockCheckOutput } },
        ],
      },
      (b) => withFakeProvider(b, fake),
    ));
    agentRuns = moduleRef.get(AgentRunService);
    channelChats = moduleRef.get(ChannelChatService);
    channels = moduleRef.get(ChannelService);
    memory = moduleRef.get(AgentMemoryService);
  });

  beforeEach(async () => {
    await resetDatabase(prisma);
    fake.requests.length = 0;
    mockCheckOutput.mockReset().mockImplementation(passThrough);
    await createResolvableModel(prisma, { slug: "test-model", modelName: "test-model", maxTokens: 8192 });
    await prisma.tierRate.create({ data: { tier: "standard", inputCreditsPerToken: 1, cachedCreditsPerToken: 1, outputCreditsPerToken: 1 } });
    await prisma.platformSetting.create({ data: { name: "memoryExtractionTimeoutSeconds", value: 15 } });
    await moduleRef.get(ModelRegistryService).refresh();
  });

  afterEach(() => jest.restoreAllMocks());

  afterAll(() => moduleRef?.close());

  /** A subscribed user funded with 1 credit. */
  const newUser = async (planSlug?: string) => {
    const user = await createUser(prisma);
    await createPackageSnapshot(prisma, { userId: user.id, collaborationEnabled: planSlug === "enterprise" });
    await fundPaidWallet(prisma, user.id, "1");
    return user;
  };

  /** An Enterprise owner's workspace with an active agent (public when asked), and a channel of the runner with it. */
  const seed = async ({ isPublic = false } = {}) => {
    const owner = await newUser("enterprise");
    const workspace = await createWorkspace(prisma, { ownerId: owner.id });
    const agent = await createAgent(prisma, { userId: owner.id, workspaceId: workspace.id, status: "active", isPublic });
    return { owner, workspace, agent };
  };

  /** The runner's own channel with the agent added (the add-time policy check). */
  const channelOf = async (userId: string, agentId: string) => {
    const channel = await prisma.channel.create({ data: { userId, name: "Room" } });
    await channels.addAgent(userId, channel.id, agentId);
    return channel;
  };

  /** One chat in this mode; the channel (for a channel chat) is made first. Returns the content and a way to run it. */
  const prepare = async (mode: Mode, userId: string, agentId: string) => {
    const channel = mode === "channel chat" ? await channelOf(userId, agentId) : null;
    return async (message: string): Promise<string> => {
      if (channel) return (await channelChats.chat(userId, channel.id, agentId, message)).content;
      return (await agentRuns.chat(userId, agentId, message)).message.content;
    };
  };

  const isExtraction = (request: ChatRequest) => request.messages[0]?.content === EXTRACTION_SYSTEM_PROMPT;
  const extractionRequests = () => fake.requests.filter(isExtraction);

  /** Holds every extraction call at the provider until `release`; `arrived` resolves when the first one reaches it. */
  const holdExtractionCalls = () => {
    const original = fake.chat.bind(fake);
    let release!: () => void;
    let arrive!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const arrived = new Promise<void>((resolve) => (arrive = resolve));
    jest.spyOn(fake, "chat").mockImplementation(async (request: ChatRequest): Promise<ChatResponse> => {
      if (!isExtraction(request)) return original(request);
      arrive();
      await gate;
      return original(request);
    });
    return { release, arrived };
  };

  /** The extraction promises started meanwhile (extractAndStore is spied, not replaced). */
  const spyExtraction = () => jest.spyOn(memory, "extractAndStore");
  const waitForExtractions = (spy: jest.SpyInstance) => Promise.all(spy.mock.results.map((r) => r.value));

  const reservationsOf = (userId: string) =>
    prisma.creditReservation.findMany({ where: { account: { userId } }, orderBy: { createdAt: "asc" } });

  describe.each(MODES)("%s", (mode) => {
    it("AC1/AC7 success: the chat finishes while its extraction call is still pending; the extraction then runs once, as its own settled run, and stores the fact", async () => {
      const { owner, workspace, agent } = await seed();
      const run = await prepare(mode, owner.id, agent.id);
      fake.enqueue({ content: "Hello", usage: { prompt_tokens: 100, completion_tokens: 10 } }, { content: JSON.stringify([FACT]), usage: { prompt_tokens: 50, completion_tokens: 5 } });
      const held = holdExtractionCalls();
      const extraction = spyExtraction();
      try {
        const bound = new Promise<string>((_resolve, reject) => setTimeout(() => reject(new Error("the chat waited for its memory extraction")), CHAT_BOUND_MS).unref());
        const content = await Promise.race([run("I like Rust"), bound]);
        await held.arrived;

        expect(content).toBe("Hello");
        expect(extraction).toHaveBeenCalledTimes(1);
        const [chatReservation, extractionReservation] = await reservationsOf(owner.id);
        expect([chatReservation.status, extractionReservation.status]).toEqual(["settled", "open"]);
        expect(await prisma.workspaceMemory.count()).toBe(0);
      } finally {
        held.release();
      }
      await waitForExtractions(extraction);

      expect(extractionRequests()).toHaveLength(1);
      expect((await reservationsOf(owner.id)).map((r) => [r.status, r.consumed.toFixed(6)])).toEqual([
        ["settled", "0.000110"],
        ["settled", "0.000055"],
      ]);
      expect(await prisma.workspaceMemory.findMany({ where: { workspaceId: workspace.id } })).toEqual([expect.objectContaining({ content: "Likes Rust" })]);
      await assertCreditLedgerInvariants(prisma);
    });

    it("AC7 failure: a failed extraction call leaves the chat's answer, stored message and settled reservation as they are; its own hold is released", async () => {
      const { owner, agent } = await seed();
      const run = await prepare(mode, owner.id, agent.id);
      fake.enqueue({ content: "Hello", usage: { prompt_tokens: 100, completion_tokens: 10 } }, { error: { code: 500, message: "down" } });
      const extraction = spyExtraction();

      const content = await run("I like Rust");
      await waitForExtractions(extraction);

      expect(content).toBe("Hello");
      expect(extractionRequests()).toHaveLength(1);
      expect((await reservationsOf(owner.id)).map((r) => [r.status, r.consumed.toFixed(6)])).toEqual([
        ["settled", "0.000110"],
        ["released", "0.000000"],
      ]);
      const account = await prisma.creditAccount.findUniqueOrThrow({ where: { userId_wallet: { userId: owner.id, wallet: "paid" } } });
      expect([account.balance.toFixed(6), account.held.toFixed(6)]).toEqual(["0.999890", "0.000000"]);
      expect(await prisma.workspaceMemory.count()).toBe(0);
      await assertCreditLedgerInvariants(prisma);
    });

    it("AC6: a transformed answer: only the approved, saved text reaches the extraction, never the raw answer", async () => {
      const { owner, agent } = await seed();
      const run = await prepare(mode, owner.id, agent.id);
      mockCheckOutput.mockImplementation(async () => ({ blocked: false, content: "APPROVED MASKED ANSWER" }));
      fake.enqueue({ content: "RAW ANSWER 0812-0000-3535" }, { content: "[]" });
      const extraction = spyExtraction();

      const content = await run("Hi");
      await waitForExtractions(extraction);

      expect(content).toBe("APPROVED MASKED ANSWER");
      const [request] = extractionRequests();
      expect(JSON.stringify(request.messages)).toContain("APPROVED MASKED ANSWER");
      expect(JSON.stringify(request.messages)).not.toContain("RAW ANSWER");
    });

    it("AC2: a blocked answer: no extraction call, no extraction hold, nothing stored", async () => {
      const { owner, agent } = await seed();
      const run = await prepare(mode, owner.id, agent.id);
      mockCheckOutput.mockImplementation(async () => ({ blocked: true, sanitized: "SANITIZED", content: "" }) as never);
      fake.enqueue({ content: "RAW BLOCKED ANSWER" });
      const extraction = spyExtraction();

      await run("Hi");
      await waitForExtractions(extraction);

      expect(extraction).not.toHaveBeenCalled();
      expect(fake.requests).toHaveLength(1);
      expect((await reservationsOf(owner.id)).map((r) => r.status)).toEqual(["settled"]);
      expect(await prisma.workspaceMemory.count()).toBe(0);
    });

    it("AC2: the answer cannot be saved: the chat fails, and there is no extraction call", async () => {
      const { owner, agent } = await seed();
      const run = await prepare(mode, owner.id, agent.id);
      if (mode === "channel chat") {
        const save = channels.saveMessage.bind(channels);
        jest.spyOn(channels, "saveMessage").mockImplementation(async (id, userId, data) => {
          if (data.role === "assistant") throw new Error("persist failed");
          return save(id, userId, data);
        });
      } else {
        const create = prisma.agentMessage.create.bind(prisma.agentMessage);
        jest.spyOn(prisma.agentMessage, "create").mockImplementation(((args: { data: { role: string } }) => {
          if (args.data.role === "assistant") return Promise.reject(new Error("persist failed"));
          return create(args as never);
        }) as never);
      }
      fake.enqueue({ content: "Hello" });
      const extraction = spyExtraction();

      await expect(run("Hi")).rejects.toThrow("persist failed");
      await waitForExtractions(extraction);

      expect(extraction).not.toHaveBeenCalled();
      expect(extractionRequests()).toHaveLength(0);
      expect(await prisma.workspaceMemory.count()).toBe(0);
    });

    it("AC2: a run outside the workspace (an outsider on the public agent, R17): no extraction call, no extraction hold", async () => {
      const { agent } = await seed({ isPublic: true });
      const outsider = await newUser();
      const run = await prepare(mode, outsider.id, agent.id);
      fake.enqueue({ content: "Hello" });
      const extraction = spyExtraction();

      expect(await run("I like Rust")).toBe("Hello");
      await waitForExtractions(extraction);

      expect(fake.requests).toHaveLength(1);
      expect((await reservationsOf(outsider.id)).map((r) => r.status)).toEqual(["settled"]);
      expect((await prisma.workspaceMemory.count()) + (await prisma.userMemory.count())).toBe(0);
    });

    it("AC2: the run policy refuses the run (a removed member): 404, no call at all, no extraction", async () => {
      const { workspace, agent } = await seed();
      const member = await newUser();
      const row = await prisma.workspaceMember.create({ data: { workspaceId: workspace.id, userId: member.id, role: "member", status: "active", joinedAt: new Date() } });
      const run = await prepare(mode, member.id, agent.id);
      await prisma.workspaceMember.update({ where: { id: row.id }, data: { status: "removed" } });
      const extraction = spyExtraction();

      await expect(run("I like Rust")).rejects.toThrow(NotFoundException);

      expect(extraction).not.toHaveBeenCalled();
      expect(fake.requests).toHaveLength(0);
      expect(await prisma.creditReservation.count()).toBe(0);
    });
  });
});
