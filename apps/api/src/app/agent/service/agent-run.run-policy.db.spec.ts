import { randomUUID } from "node:crypto";
import { ConflictException, ForbiddenException, NotFoundException } from "@nestjs/common";
import { TestingModule } from "@nestjs/testing";
import { AgentRunService } from "./agent-run.service";
import { AgentRunPolicyService } from "./agent-run-policy.service";
import { AgentLinkService } from "./agent-link.service";
import { AgentMemoryService } from "./agent-memory.service";
import { AgentRunMeterService } from "./agent-run-meter.service";
import { AgentToolService } from "./agent-tool.service";
import { KnowledgeService } from "../../knowledge/service/knowledge.service";
import { EmbeddingService } from "../../knowledge/service/embedding.service";
import { S3Service } from "../../knowledge/service/s3.service";
import { WorkspaceKnowledgeService } from "../../workspace/service/workspace-knowledge.service";
import { WorkspaceQuotaService } from "../../workspace/service/workspace-quota.service";
import { UsageService } from "../../usage/service/usage.service";
import { GuardrailService } from "../../guardrail/service/guardrail.service";
import { ModelRegistryService } from "../../config/model-registry.service";
import { CreditService } from "../../billing/service/credit.service";
import { PlatformSettingsService } from "../../offers/service/platform-settings.service";
import { ProvidersModule } from "../../providers/providers.module";
import { PrismaService } from "../../prisma/prisma.service";
import { createTestModule } from "../../../../test/test-module";
import { resetDatabase } from "../../../../test/test-database";
import { createAgent, createPackageSnapshot, createPlan, createSubscription, createUser, createWorkspace } from "../../../../test/factories";
import { withdrawCollaboration } from "../../../../test/withdraw-collaboration";
import { FakeProviderAdapter, withFakeProvider } from "../../../../test/fake-provider";
import { createResolvableModel } from "../../../../test/provider-model";
import { fundPaidWallet } from "../../../../test/credit-funding";

// RNX-119 (D257): one run policy on every run entry, runs per person and the R17 memory gate, on the agent chat
// entry. A run is INSIDE the agent's workspace for its owner and for a current member of an Enterprise owner's
// workspace (D64), OUTSIDE it for anyone running a public active agent, and refused (404) for anyone else. The runner
// pays from their own paid wallet, behind the D192 subscription gate. Real AgentRunService, run policy, AgentLinkService,
// AgentMemoryService, knowledge services, meter, CreditService and UsageService on the test database; the model is the
// fake provider and embeddings a fixed unit vector. These collaborators load ESM-only packages and are stubbed.
jest.mock("./agent-tool.service", () => ({ AgentToolService: class {} }));
jest.mock("../../guardrail/service/guardrail.service", () => ({ GuardrailService: class {} }));
jest.mock("../../knowledge/service/embedding.service", () => ({ EmbeddingService: class {} }));
jest.mock("../../knowledge/service/s3.service", () => ({ S3Service: class {} }));

const CALL_AGENT = { type: "function", function: { name: "call_agent", description: "Call", parameters: {} } };
const AGENT_PROMPT = "TEAM AGENT PROMPT";

const unit = () => {
  const v = new Array(1024).fill(0);
  v[0] = 1;
  return v;
};

describe("RNX-119: the run policy on agent chat, runs per person, the memory gate (test database, fake provider)", () => {
  const fake = new FakeProviderAdapter();
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let service: AgentRunService;
  let memory: AgentMemoryService;

  beforeAll(async () => {
    ({ moduleRef, prisma } = await createTestModule(
      {
        imports: [ProvidersModule],
        providers: [
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
          KnowledgeService,
          WorkspaceKnowledgeService,
          { provide: EmbeddingService, useValue: { modelName: "test-model", embedSingle: async () => ({ embedding: unit(), tokenCount: 1 }) } },
          { provide: S3Service, useValue: {} },
          {
            // Same call_agent rule as AgentToolService.buildToolSchemas
            provide: AgentToolService,
            useValue: {
              buildToolSchemasWithMcp: async (
                _tools: unknown,
                _agentId: string,
                _userId?: string,
                _workspaceId?: string,
                options?: { injectCallAgent?: boolean },
              ) => (options?.injectCallAgent ? [CALL_AGENT] : []),
              cleanupMcpConnections: async () => undefined,
            },
          },
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
    service = moduleRef.get(AgentRunService);
    memory = moduleRef.get(AgentMemoryService);
  });

  beforeEach(async () => {
    await resetDatabase(prisma);
    fake.requests.length = 0;
    await createResolvableModel(prisma, { slug: "test-model", modelName: "test-model", maxTokens: 8192 });
    await prisma.tierRate.create({
      data: { tier: "standard", inputCreditsPerToken: 1, cachedCreditsPerToken: 1, outputCreditsPerToken: 1 },
    });
    await moduleRef.get(ModelRegistryService).refresh();
  });

  afterEach(() => jest.restoreAllMocks());

  afterAll(() => moduleRef?.close());

  /** A user on a plan with this slug; subscribed (active) and funded with 1 credit unless told otherwise. */
  const newUser = async ({ planSlug, subscribed = true }: { planSlug?: string; subscribed?: boolean } = {}) => {
    const user = await createUser(prisma);
    const plan = await createPlan(prisma, planSlug ? { slug: planSlug, maxWorkspaceUsers: 100 } : {});
    await createSubscription(prisma, { userId: user.id, planId: plan.id, status: subscribed ? "active" : "canceled" });
    // RNX-76 B3 (D297): an "enterprise" user collaborates through a package snapshot, not the plan.
    if (planSlug === "enterprise") await createPackageSnapshot(prisma, { userId: user.id, collaborationEnabled: true });
    await fundPaidWallet(prisma, user.id, "1");
    return user;
  };

  const insertChunk = (knowledgeBaseId: string, content: string) =>
    prisma.$executeRaw`
      INSERT INTO "knowledge_chunks" (id, "knowledgeBaseId", content, metadata, embedding, "tokenCount", "createdAt", embedding_model, embedded_at)
      VALUES (${randomUUID()}, ${knowledgeBaseId}, ${content}, '{}'::jsonb, ${`[${unit().join(",")}]`}::vector, 1, now(), 'test-model', now())`;

  /**
   * The owner's workspace (owner's plan `ownerPlan`) with its owner member row, a private active agent with a
   * workspace knowledge base attached, a linked helper, and one workspace memory.
   */
  const seedWorkspace = async ({ ownerPlan = "enterprise", isPublic = false } = {}) => {
    const owner = await newUser({ planSlug: ownerPlan });
    const workspace = await createWorkspace(prisma, { ownerId: owner.id });
    await prisma.workspaceMember.create({
      data: { workspaceId: workspace.id, userId: owner.id, role: "owner", status: "active", joinedAt: new Date() },
    });
    const agent = await createAgent(prisma, {
      userId: owner.id,
      workspaceId: workspace.id,
      systemPrompt: AGENT_PROMPT,
      status: "active",
      isPublic,
    });
    const knowledgeBase = await prisma.knowledgeBase.create({
      data: { userId: owner.id, workspaceId: workspace.id, name: "Team KB" },
    });
    await insertChunk(knowledgeBase.id, "TEAM KNOWLEDGE CHUNK");
    await prisma.agentKnowledgeBase.create({ data: { agentId: agent.id, knowledgeBaseId: knowledgeBase.id } });
    const helper = await createAgent(prisma, {
      userId: owner.id,
      workspaceId: workspace.id,
      name: "Team helper",
      systemPrompt: "HELPER PROMPT",
      status: "active",
    });
    await prisma.agentLink.create({ data: { callerAgentId: agent.id, calleeAgentId: helper.id } });
    await prisma.workspaceMemory.create({
      data: { workspaceId: workspace.id, type: "fact", content: "TEAM MEMORY FACT", status: "active" },
    });
    return { owner, workspace, agent, helper };
  };

  /** A user with a member row of this workspace in this status (subscribed and funded unless told otherwise). */
  const addMember = async (workspaceId: string, status: "active" | "removed" = "active", subscribed = true) => {
    const user = await newUser({ subscribed });
    await prisma.workspaceMember.create({
      data: { workspaceId, userId: user.id, role: "member", status, joinedAt: new Date() },
    });
    return user;
  };

  /** One chat; waits for its (asynchronous) memory extraction to end, so the next run's model calls do not interleave. */
  const chat = async (userId: string, agentId: string, message: string, sessionId?: string) => {
    const extraction = jest.spyOn(memory, "extractAndStore");
    const result = await service.chat(userId, agentId, message, sessionId);
    await Promise.all(extraction.mock.results.map((r) => r.value));
    extraction.mockRestore();
    return result;
  };

  /** The run requests (the root agent's calls), not the memory extraction calls. */
  const runRequests = () =>
    fake.requests.filter((r) => String((r.messages as { content: unknown }[])[0].content).includes(AGENT_PROMPT));

  const accountOf = (userId: string) =>
    prisma.creditAccount.findUniqueOrThrow({ where: { userId_wallet: { userId, wallet: "paid" } } });

  const nothingCharged = async () => {
    expect(fake.requests).toHaveLength(0);
    expect(await prisma.creditReservation.count()).toBe(0);
    expect(await prisma.creditLedgerEntry.count({ where: { type: "usage" } })).toBe(0);
    expect(await prisma.agentRun.count()).toBe(0);
  };

  /** The owner and a collaborator each run the agent once; each gets their own run. */
  const twoRuns = async () => {
    const seeded = await seedWorkspace();
    const collaborator = await addMember(seeded.workspace.id);
    fake.enqueue({ content: "owner answer" }, { content: "[]" }, { content: "collaborator answer" }, { content: "[]" });
    const ownerRun = await chat(seeded.owner.id, seeded.agent.id, "OWNER QUESTION");
    const collaboratorRun = await chat(collaborator.id, seeded.agent.id, "COLLABORATOR QUESTION");
    return { ...seeded, collaborator, ownerRun, collaboratorRun };
  };

  describe("AC1: who may run the workspace's private agent", () => {
    it("an Enterprise collaborator runs it with the same prompt, model, knowledge and links as the owner", async () => {
      const { owner, workspace, agent } = await seedWorkspace();
      const collaborator = await addMember(workspace.id);
      fake.enqueue({ content: "owner answer" }, { content: "[]" }, { content: "collaborator answer" }, { content: "[]" });

      const ownerResult = await chat(owner.id, agent.id, "What do we know?");
      const collaboratorResult = await chat(collaborator.id, agent.id, "What do we know?");

      expect([ownerResult.message.content, collaboratorResult.message.content]).toEqual(["owner answer", "collaborator answer"]);
      const [ownerCall, collaboratorCall] = runRequests();
      expect(collaboratorCall.messages).toEqual(ownerCall.messages);
      expect([collaboratorCall.model, collaboratorCall.tools]).toEqual([ownerCall.model, ownerCall.tools]);
      const prompt = String(collaboratorCall.messages[0].content);
      expect(prompt).toContain("TEAM KNOWLEDGE CHUNK");
      expect(prompt).toContain("## Callable Agents\n- Team helper");
      expect(prompt).toContain("TEAM MEMORY FACT");
      expect(collaboratorCall.tools?.map((t: any) => t.function.name)).toEqual(["call_agent"]);
    });

    it("a removed member is refused: 404 Agent not found, before any model call, run or charge", async () => {
      const { workspace, agent } = await seedWorkspace();
      const former = await addMember(workspace.id, "removed");

      await expect(service.assertRunCanStart(former.id, agent.id, "Hi")).rejects.toThrow(new NotFoundException("Agent not found"));
      await expect(service.chat(former.id, agent.id, "Hi")).rejects.toThrow(new NotFoundException("Agent not found"));

      await nothingCharged();
    });

    it.each(["starter", "pro"])(
      "a %s owner's workspace with a stale active member row: that member is refused with 404, nothing charged",
      async (ownerPlan) => {
        const { workspace, agent } = await seedWorkspace({ ownerPlan });
        const stale = await addMember(workspace.id);

        await expect(service.assertRunCanStart(stale.id, agent.id, "Hi")).rejects.toThrow(new NotFoundException("Agent not found"));
        await expect(service.chat(stale.id, agent.id, "Hi")).rejects.toThrow(new NotFoundException("Agent not found"));

        await nothingCharged();
      },
    );

    it("a user with no member row is refused with 404 (control: the policy, not the member row, decides)", async () => {
      const { agent } = await seedWorkspace();
      const stranger = await newUser();

      await expect(service.chat(stranger.id, agent.id, "Hi")).rejects.toThrow(new NotFoundException("Agent not found"));

      await nothingCharged();
    });
  });

  describe("AC3: the runner pays, behind the D192 subscription gate", () => {
    it("a collaborator without an active subscription is refused with 403 before any model call, run or charge", async () => {
      const { workspace, agent } = await seedWorkspace();
      const collaborator = await addMember(workspace.id, "active", false);

      await expect(service.assertRunCanStart(collaborator.id, agent.id, "Hi")).rejects.toThrow(
        new ForbiddenException("Active subscription required to use AI Agents."),
      );
      await expect(service.chat(collaborator.id, agent.id, "Hi")).rejects.toThrow(
        new ForbiddenException("Active subscription required to use AI Agents."),
      );

      await nothingCharged();
    });

    it("a subscribed collaborator's run reserves on the collaborator's own paid wallet, not the owner's", async () => {
      const { owner, workspace, agent } = await seedWorkspace();
      const collaborator = await addMember(workspace.id);
      fake.enqueue({ content: "Hello", usage: { prompt_tokens: 100, completion_tokens: 10 } }, { content: "[]" });

      await chat(collaborator.id, agent.id, "Hi");

      const reservations = await prisma.creditReservation.findMany({ include: { account: true } });
      expect(reservations.map((r) => [r.account.userId, r.wallet, r.status])).toEqual([[collaborator.id, "paid", "settled"]]);
      const entries = await prisma.creditLedgerEntry.findMany({ where: { type: "usage" } });
      expect(entries.map((e) => e.memberUserId)).toEqual([collaborator.id]);
      expect((await accountOf(collaborator.id)).balance.toFixed(6)).toBe("0.999890");
      expect((await accountOf(owner.id)).balance.toFixed(6)).toBe("1.000000");
    });
  });

  describe("AC4: runs per person", () => {
    it("each run belongs to its runner; listRuns and getRun show each person only their own", async () => {
      const { owner, collaborator, agent, ownerRun, collaboratorRun } = await twoRuns();

      const runs = await prisma.agentRun.findMany({ orderBy: { createdAt: "asc" } });
      expect(runs.map((r) => [r.id, r.userId])).toEqual([
        [ownerRun.runId, owner.id],
        [collaboratorRun.runId, collaborator.id],
      ]);
      expect((await service.listRuns(owner.id, agent.id)).map((r) => r.id)).toEqual([ownerRun.runId]);
      expect((await service.listRuns(collaborator.id, agent.id)).map((r) => r.id)).toEqual([collaboratorRun.runId]);
      const own = await service.getRun(collaborator.id, agent.id, collaboratorRun.runId);
      expect(own.messages.map((m) => m.content)).toEqual(["COLLABORATOR QUESTION", "collaborator answer"]);
    });

    it("the workspace owner asking for a collaborator's run gets 403 (get and delete), and the run is kept", async () => {
      const { owner, agent, collaboratorRun } = await twoRuns();

      await expect(service.getRun(owner.id, agent.id, collaboratorRun.runId)).rejects.toThrow(ForbiddenException);
      await expect(service.deleteRun(owner.id, agent.id, collaboratorRun.runId)).rejects.toThrow(ForbiddenException);

      expect(await prisma.agentRun.count({ where: { id: collaboratorRun.runId } })).toBe(1);
    });

    it("a collaborator asking for the owner's run gets 403 too; their own run is deleted (control)", async () => {
      const { collaborator, agent, ownerRun, collaboratorRun } = await twoRuns();

      await expect(service.getRun(collaborator.id, agent.id, ownerRun.runId)).rejects.toThrow(ForbiddenException);
      await service.deleteRun(collaborator.id, agent.id, collaboratorRun.runId);

      expect((await prisma.agentRun.findMany()).map((r) => r.id)).toEqual([ownerRun.runId]);
    });

    // RNX-260 (D259, 78): own runs need only "this run is mine"; outside the workspace another person's run is 404
    // (was "Agent not found" for every call, own runs included), and the list holds only the caller's runs (none here).
    it("someone outside the workspace asking for another person's run gets 404; their list is empty", async () => {
      const { agent, ownerRun } = await twoRuns();
      const stranger = await newUser();

      await expect(service.getRun(stranger.id, agent.id, ownerRun.runId)).rejects.toThrow(new NotFoundException("Run not found"));
      await expect(service.deleteRun(stranger.id, agent.id, ownerRun.runId)).rejects.toThrow(new NotFoundException("Run not found"));
      expect(await service.listRuns(stranger.id, agent.id)).toEqual([]);
      expect(await prisma.agentRun.count({ where: { id: ownerRun.runId } })).toBe(1);
    });

    it("the active-run lookup finds only the caller's run: another person's session id opens a new run, without its history", async () => {
      const { collaborator, agent, ownerRun } = await twoRuns();
      fake.requests.length = 0;
      fake.enqueue({ content: "second answer" }, { content: "[]" });

      const result = await chat(collaborator.id, agent.id, "SECOND QUESTION", ownerRun.sessionId);

      expect(result.runId).not.toBe(ownerRun.runId);
      expect(JSON.stringify(runRequests()[0].messages)).not.toContain("OWNER QUESTION");
      const ownerMessages = await prisma.agentMessage.findMany({ where: { runId: ownerRun.runId } });
      expect(ownerMessages.map((m) => m.content).sort()).toEqual(["OWNER QUESTION", "owner answer"]);
    });

    it("the owner's own session keeps its history (control)", async () => {
      const { owner, agent, ownerRun } = await twoRuns();
      fake.requests.length = 0;
      fake.enqueue({ content: "second answer" }, { content: "[]" });

      const result = await chat(owner.id, agent.id, "SECOND QUESTION", ownerRun.sessionId);

      expect(result.runId).toBe(ownerRun.runId);
      expect(JSON.stringify(runRequests()[0].messages)).toContain("OWNER QUESTION");
    });

    it("GET /usage is per person: the owner's usage does not include the collaborator's", async () => {
      const { owner, collaborator } = await twoRuns();
      const usage = moduleRef.get(UsageService);

      const ownerUsage = await usage.getUsageByUser(owner.id);
      const collaboratorUsage = await usage.getUsageByUser(collaborator.id);

      const allLogs = await prisma.usageLog.findMany();
      expect(new Set(allLogs.map((l) => l.userId))).toEqual(new Set([owner.id, collaborator.id]));
      expect(ownerUsage.logs.length).toBeGreaterThan(0);
      expect(new Set(ownerUsage.logs.map((l) => l.userId))).toEqual(new Set([owner.id]));
      expect(new Set(collaboratorUsage.logs.map((l) => l.userId))).toEqual(new Set([collaborator.id]));
      expect(ownerUsage.total + collaboratorUsage.total).toBe(allLogs.length);
    });
  });

  describe("RNX-260 (D259): agent status, workspace status, own runs", () => {
    const CLOSED = new ConflictException("This workspace is archived or deleted: no new run can start in it");

    it.each(["draft", "archived"])("AC5: a collaborator running a %s agent is refused (404), nothing charged", async (status) => {
      const { workspace, agent } = await seedWorkspace();
      const collaborator = await addMember(workspace.id);
      await prisma.agent.update({ where: { id: agent.id }, data: { status } });

      await expect(service.assertRunCanStart(collaborator.id, agent.id, "Hi")).rejects.toThrow(new NotFoundException("Agent not found"));
      await expect(service.chat(collaborator.id, agent.id, "Hi")).rejects.toThrow(new NotFoundException("Agent not found"));

      await nothingCharged();
    });

    it.each(["draft", "archived"])("AC5: the owner runs a %s agent (control)", async (status) => {
      const { owner, agent } = await seedWorkspace();
      await prisma.agent.update({ where: { id: agent.id }, data: { status } });
      fake.enqueue({ content: "owner answer" }, { content: "[]" });

      await service.assertRunCanStart(owner.id, agent.id, "Hi");
      const result = await chat(owner.id, agent.id, "Hi");

      expect(result.message.content).toBe("owner answer");
    });

    it.each(["archived", "deleted"])(
      "AC6: the workspace is %s: the owner and a collaborator starting a run get 409, nothing charged; their earlier runs are listed and deleted",
      async (status) => {
        const { owner, collaborator, workspace, agent, ownerRun, collaboratorRun } = await twoRuns();
        fake.requests.length = 0;
        const charged = {
          reservations: await prisma.creditReservation.count(),
          usage: await prisma.creditLedgerEntry.count({ where: { type: "usage" } }),
          runs: await prisma.agentRun.count(),
        };
        await prisma.workspace.update({ where: { id: workspace.id }, data: { status } });

        for (const runner of [owner, collaborator]) {
          await expect(service.assertRunCanStart(runner.id, agent.id, "Hi")).rejects.toThrow(CLOSED);
          await expect(service.chat(runner.id, agent.id, "Hi")).rejects.toThrow(CLOSED);
        }

        expect(fake.requests).toHaveLength(0);
        expect({
          reservations: await prisma.creditReservation.count(),
          usage: await prisma.creditLedgerEntry.count({ where: { type: "usage" } }),
          runs: await prisma.agentRun.count(),
        }).toEqual(charged);
        expect((await service.listRuns(owner.id, agent.id)).map((r) => r.id)).toEqual([ownerRun.runId]);
        expect((await service.listRuns(collaborator.id, agent.id)).map((r) => r.id)).toEqual([collaboratorRun.runId]);
        await service.deleteRun(owner.id, agent.id, ownerRun.runId);
        await service.deleteRun(collaborator.id, agent.id, collaboratorRun.runId);
        expect(await prisma.agentRun.count()).toBe(0);
      },
    );

    it("AC7: an outsider who ran the public agent, then it was unpublished: lists, reads and deletes their own run", async () => {
      const { agent } = await seedWorkspace({ isPublic: true });
      const outsider = await newUser();
      fake.enqueue({ content: "Hello" });
      const run = await chat(outsider.id, agent.id, "OUTSIDER QUESTION");
      await prisma.agent.update({ where: { id: agent.id }, data: { isPublic: false } });

      const listed = await service.listRuns(outsider.id, agent.id);
      const read = await service.getRun(outsider.id, agent.id, run.runId);
      await service.deleteRun(outsider.id, agent.id, run.runId);

      expect(listed.map((r) => r.id)).toEqual([run.runId]);
      expect(read.messages.map((m) => m.content)).toEqual(["OUTSIDER QUESTION", "Hello"]);
      expect(await prisma.agentRun.count()).toBe(0);
    });

    it("AC7: a collaborator whose owner's plan no longer allows collaboration lists and deletes their own run; another person's run is 404", async () => {
      const { owner, collaborator, agent, ownerRun, collaboratorRun } = await twoRuns();
      const pro = await createPlan(prisma, { slug: "pro" });
      await prisma.userSubscription.update({ where: { userId: owner.id }, data: { planId: pro.id } });
      withdrawCollaboration(owner.id);

      const listed = await service.listRuns(collaborator.id, agent.id);
      await expect(service.getRun(collaborator.id, agent.id, ownerRun.runId)).rejects.toThrow(new NotFoundException("Run not found"));
      await expect(service.deleteRun(collaborator.id, agent.id, ownerRun.runId)).rejects.toThrow(new NotFoundException("Run not found"));
      await service.deleteRun(collaborator.id, agent.id, collaboratorRun.runId);

      expect(listed.map((r) => r.id)).toEqual([collaboratorRun.runId]);
      expect((await prisma.agentRun.findMany()).map((r) => r.id)).toEqual([ownerRun.runId]);
    });
  });

  describe("AC5: the R17 memory gate", () => {
    it("an outsider running the public agent: no workspace memory in the prompt, no extraction call, no fact written", async () => {
      const { agent } = await seedWorkspace({ isPublic: true });
      const outsider = await newUser();
      const memoriesBefore = await prisma.workspaceMemory.count();
      // Only the run's turn: an extraction call (the gate broken) would find no turn left and be counted in requests.
      fake.enqueue({ content: "Hello" });

      await chat(outsider.id, agent.id, "I like Rust");

      expect(fake.requests).toHaveLength(1);
      expect(String(fake.requests[0].messages[0].content)).not.toContain("TEAM MEMORY FACT");
      expect(await prisma.workspaceMemory.count()).toBe(memoriesBefore);
      expect(await prisma.userMemory.count()).toBe(0);
    });

    it("a collaborator inside uses the workspace memory and its fact is written there (control)", async () => {
      const { workspace, agent } = await seedWorkspace({ isPublic: true });
      const collaborator = await addMember(workspace.id);
      fake.enqueue(
        { content: "Hello" },
        { content: '[{"type":"interest","content":"COLLABORATOR LIKES RUST","confidence":0.9}]' },
      );

      await chat(collaborator.id, agent.id, "I like Rust");

      expect(String(fake.requests[0].messages[0].content)).toContain("TEAM MEMORY FACT");
      const written = await prisma.workspaceMemory.findMany({ where: { workspaceId: workspace.id, createdById: collaborator.id } });
      expect(written.map((m) => m.content)).toEqual(["COLLABORATOR LIKES RUST"]);
    });
  });
});
