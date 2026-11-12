import { ForbiddenException, NotFoundException } from "@nestjs/common";
import { TestingModule } from "@nestjs/testing";
import { AgentRunService } from "./agent-run.service";
import { AgentRunPolicyService } from "./agent-run-policy.service";
import { AgentLinkService } from "./agent-link.service";
import { AgentMemoryService } from "./agent-memory.service";
import { AgentRunMeterService } from "./agent-run-meter.service";
import { AgentToolService } from "./agent-tool.service";
import { AgentRunRepository } from "../repository/agent-run.repository";
import { KnowledgeService } from "../../knowledge/service/knowledge.service";
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
import { createAgent, createPackageSnapshot, createUser, createWorkspace } from "../../../../test/factories";
import { FakeProviderAdapter, withFakeProvider } from "../../../../test/fake-provider";
import { createResolvableModel } from "../../../../test/provider-model";
import { fundPaidWallet } from "../../../../test/credit-funding";

// RNX-302: an agent run records its hops (child runs) through AgentRunRepository.createChildRun: parent run, depth,
// the parent's model call id, duration, status, the task and the approved answer as its two messages, in the parent's
// session and channel. listRuns and the session lookup see top-level runs only; deleting a top-level run deletes its
// hops (ON DELETE CASCADE); another person's delete is still refused (RNX-260: 404 outside, 403 inside the workspace).
// Real AgentRunService, run policy, meter and ledger on the test database; fake provider. These collaborators load
// ESM-only packages and are stubbed.
jest.mock("./agent-tool.service", () => ({ AgentToolService: class {} }));
jest.mock("../../guardrail/service/guardrail.service", () => ({ GuardrailService: class {} }));
jest.mock("../../knowledge/service/knowledge.service", () => ({ KnowledgeService: class {} }));

describe("RNX-302: agent run hops (test database, fake provider)", () => {
  const fake = new FakeProviderAdapter();
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let service: AgentRunService;
  let runs: AgentRunRepository;

  beforeAll(async () => {
    ({ moduleRef, prisma } = await createTestModule(
      {
        imports: [ProvidersModule],
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
          { provide: AgentToolService, useValue: { buildToolSchemasWithMcp: async () => [], cleanupMcpConnections: async () => undefined } },
          { provide: AgentMemoryService, useValue: { getMemoryContext: async () => "", extractAndStore: async () => undefined } },
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
    service = moduleRef.get(AgentRunService);
    runs = moduleRef.get(AgentRunRepository);
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

  afterAll(() => moduleRef?.close());

  /**
   * An Enterprise owner's workspace (collaboration allowed) with a collaborator, the owner's agent and a helper agent;
   * the owner runs the agent once (the top-level run), and the run gets two hops: the helper at depth 1, and the agent
   * again (called by the helper) at depth 2.
   */
  const seedRunWithHops = async () => {
    const owner = await createUser(prisma);
    await createPackageSnapshot(prisma, { userId: owner.id, collaborationEnabled: true });
    await fundPaidWallet(prisma, owner.id, "1");
    const workspace = await createWorkspace(prisma, { ownerId: owner.id });
    await prisma.workspaceMember.create({
      data: { workspaceId: workspace.id, userId: owner.id, role: "owner", status: "active", joinedAt: new Date() },
    });
    const collaborator = await createUser(prisma);
    await prisma.workspaceMember.create({
      data: { workspaceId: workspace.id, userId: collaborator.id, role: "member", status: "active", joinedAt: new Date() },
    });
    const agent = await createAgent(prisma, { userId: owner.id, workspaceId: workspace.id, status: "active" });
    const helper = await createAgent(prisma, { userId: owner.id, workspaceId: workspace.id, status: "active" });
    fake.enqueue({ content: "top answer" });
    const top = await service.chat(owner.id, agent.id, "TOP QUESTION");
    const firstHop = await runs.createChildRun({
      parentRunId: top.runId,
      agentId: helper.id,
      userId: owner.id,
      depth: 1,
      status: "completed",
      durationMs: 1200,
      parentCallId: "call-top-1",
      task: "HELPER TASK",
      answer: "HELPER ANSWER",
    });
    const secondHop = await runs.createChildRun({
      parentRunId: firstHop.id,
      agentId: agent.id,
      userId: owner.id,
      depth: 2,
      status: "timeout",
      durationMs: 800,
      parentCallId: "call-helper-1",
      task: "NESTED TASK",
      answer: "NESTED ANSWER",
    });
    return { owner, collaborator, agent, helper, top, firstHop, secondHop };
  };

  describe("AC2: hops are stored, and only top-level runs are listed or continued", () => {
    it("records each hop under its parent, in the parent's session and channel, with the task and the answer as its messages", async () => {
      const { owner, agent, helper, top, firstHop, secondHop } = await seedRunWithHops();

      const actualRuns = await prisma.agentRun.findMany({ orderBy: { depth: "asc" } });
      expect(
        actualRuns.map((r) => [r.id, r.agentId, r.userId, r.parentRunId, r.depth, r.status, r.parentCallId, r.durationMs]),
      ).toEqual([
        [top.runId, agent.id, owner.id, null, 0, "active", null, null],
        [firstHop.id, helper.id, owner.id, top.runId, 1, "completed", "call-top-1", 1200],
        [secondHop.id, agent.id, owner.id, firstHop.id, 2, "timeout", "call-helper-1", 800],
      ]);
      expect(actualRuns.map((r) => [r.sessionId, r.channelType])).toEqual(
        new Array(3).fill([top.sessionId, "web"]),
      );
      const hopMessages = await prisma.agentMessage.findMany({ where: { runId: firstHop.id }, orderBy: { createdAt: "asc" } });
      expect(hopMessages.map((m) => [m.role, m.content])).toEqual([
        ["user", "HELPER TASK"],
        ["assistant", "HELPER ANSWER"],
      ]);
    });

    it("listRuns lists the runner's top-level run only, for the calling agent and for the called one", async () => {
      const { owner, agent, helper, top } = await seedRunWithHops();

      expect((await service.listRuns(owner.id, agent.id)).map((r) => r.id)).toEqual([top.runId]);
      expect(await service.listRuns(owner.id, helper.id)).toEqual([]);
    });

    it("a message with the session id continues the top-level run, not a hop", async () => {
      const { owner, agent, top } = await seedRunWithHops();
      fake.requests.length = 0;
      fake.enqueue({ content: "second answer" });

      const actual = await service.chat(owner.id, agent.id, "SECOND QUESTION", top.sessionId);

      expect(actual.runId).toBe(top.runId);
      expect(await prisma.agentRun.count()).toBe(3);
      expect(JSON.stringify(fake.requests[0].messages)).toContain("TOP QUESTION");
      expect(JSON.stringify(fake.requests[0].messages)).not.toContain("NESTED TASK");
    });

    it("refuses a hop under another person's run: nothing is stored", async () => {
      const { collaborator, helper, top } = await seedRunWithHops();
      const inputHop = {
        parentRunId: top.runId,
        agentId: helper.id,
        userId: collaborator.id,
        depth: 1,
        status: "completed" as const,
        durationMs: 1,
        parentCallId: "call-x",
        task: "T",
        answer: "A",
      };

      await expect(runs.createChildRun(inputHop)).rejects.toThrow();

      expect(await prisma.agentRun.count()).toBe(3);
    });
  });

  describe("AC3: deleting a top-level run", () => {
    it("the runner deletes the top-level run: its hops and all their messages are gone", async () => {
      const { owner, agent, top } = await seedRunWithHops();

      await service.deleteRun(owner.id, agent.id, top.runId);

      expect(await prisma.agentRun.count()).toBe(0);
      expect(await prisma.agentMessage.count()).toBe(0);
    });

    it("a collaborator inside the workspace gets 403 and nothing is deleted", async () => {
      const { collaborator, agent, top } = await seedRunWithHops();

      await expect(service.deleteRun(collaborator.id, agent.id, top.runId)).rejects.toThrow(ForbiddenException);

      expect(await prisma.agentRun.count()).toBe(3);
      expect(await prisma.agentMessage.count()).toBe(6);
    });

    it("someone outside the workspace gets 404 Run not found and nothing is deleted", async () => {
      const { agent, top } = await seedRunWithHops();
      const stranger = await createUser(prisma);

      await expect(service.deleteRun(stranger.id, agent.id, top.runId)).rejects.toThrow(new NotFoundException("Run not found"));

      expect(await prisma.agentRun.count()).toBe(3);
      expect(await prisma.agentMessage.count()).toBe(6);
    });
  });
});
