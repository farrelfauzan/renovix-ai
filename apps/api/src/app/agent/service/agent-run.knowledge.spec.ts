import { randomUUID } from "node:crypto";
import { TestingModule } from "@nestjs/testing";
import { Decimal } from "@prisma/client/runtime/client";
import { AgentRunService } from "./agent-run.service";
import { AgentToolService } from "./agent-tool.service";
import { AgentMemoryService } from "./agent-memory.service";
import { KnowledgeService } from "../../knowledge/service/knowledge.service";
import { EmbeddingService } from "../../knowledge/service/embedding.service";
import { S3Service } from "../../knowledge/service/s3.service";
import { WorkspaceKnowledgeService } from "../../workspace/service/workspace-knowledge.service";
import { WorkspaceQuotaService } from "../../workspace/service/workspace-quota.service";
import { ModelRegistryService } from "../../config/model-registry.service";
import { CreditService } from "../../billing/service/credit.service";
import { PlatformSettingsService } from "../../offers/service/platform-settings.service";
import { AgentRunMeterService } from "./agent-run-meter.service";
import { UsageService } from "../../usage/service/usage.service";
import { GuardrailService } from "../../guardrail/service/guardrail.service";
import { ProvidersModule } from "../../providers/providers.module";
import { PrismaService } from "../../prisma/prisma.service";
import { createTestModule } from "../../../../test/test-module";
import { resetDatabase } from "../../../../test/test-database";
import { FakeProviderAdapter, withFakeProvider } from "../../../../test/fake-provider";
import { testConnection } from "../../../../test/provider-model";
import { fundPaidWallet } from "../../../../test/credit-funding";
import {
  createAgent,
  createPlan,
  createSubscription,
  createUser,
  createWorkspace,
} from "../../../../test/factories";

// RX-113 regression: retrieveKnowledge skips a base the caller cannot search
// instead of dropping the knowledge context of every attached base. RX-116
// (D71): a workspace base is searched for a current member of a workspace
// whose owner's plan allows collaboration (the owner always), and a refused
// base costs no embedding call. Real AgentRunService, KnowledgeService,
// WorkspaceKnowledgeService and WorkspaceQuotaService on the test database;
// the model is the fake provider, embeddings a fixed unit vector, the other
// collaborators are stubs.
jest.mock("./agent-tool.service", () => ({ AgentToolService: class {} }));
jest.mock("./agent-memory.service", () => ({ AgentMemoryService: class {} }));
jest.mock("../../config/model-registry.service", () => ({ ModelRegistryService: class {} }));
jest.mock("../../usage/service/usage.service", () => ({ UsageService: class {} }));
jest.mock("../../guardrail/service/guardrail.service", () => ({ GuardrailService: class {} }));
jest.mock("../../knowledge/service/embedding.service", () => ({ EmbeddingService: class {} }));
jest.mock("../../knowledge/service/s3.service", () => ({ S3Service: class {} }));

const unit = () => {
  const v = new Array(1024).fill(0);
  v[0] = 1;
  return v;
};

describe("Agent run: knowledge context per attached base (RX-113, test database, fake provider)", () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let runs: AgentRunService;
  const fake = new FakeProviderAdapter();
  const embedSingle = jest.fn(async () => ({ embedding: unit(), tokenCount: 1 }));
  const logUsage = jest.fn(async (_entry: { cost: Decimal }) => undefined);

  beforeAll(async () => {
    ({ moduleRef, prisma } = await createTestModule(
      {
        imports: [ProvidersModule],
        providers: [
          AgentRunService,
          AgentRunMeterService,
          CreditService,
          PlatformSettingsService,
          KnowledgeService,
          WorkspaceKnowledgeService,
          WorkspaceQuotaService,
          { provide: EmbeddingService, useValue: { embedSingle } },
          { provide: S3Service, useValue: {} },
          {
            provide: ModelRegistryService,
            useValue: {
              resolveModel: async () => ({ slug: "test-model" }),
              resolveConnection: async () => testConnection(),
              getUserPrice: async () => null,
              // RX-21, RX-22b: the run's charge reads the model's tier and the tier's credit rates.
              getModel: async () => ({ tier: "standard" }),
              getTierRates: async () => ({
                inputCreditsPerToken: new Decimal(1),
                cachedCreditsPerToken: new Decimal(1),
                outputCreditsPerToken: new Decimal(1),
              }),
            },
          },
          {
            provide: AgentToolService,
            useValue: { buildToolSchemasWithMcp: async () => [], cleanupMcpConnections: async () => undefined },
          },
          {
            provide: AgentMemoryService,
            useValue: { getMemoryContext: async () => "", extractAndStore: async () => undefined },
          },
          { provide: UsageService, useValue: { logUsage } },
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
    runs = moduleRef.get(AgentRunService);
  });

  beforeEach(async () => {
    await resetDatabase(prisma);
    embedSingle.mockClear();
    logUsage.mockClear();
  });

  afterAll(() => moduleRef?.close());

  const insertChunk = (knowledgeBaseId: string, content: string) =>
    prisma.$executeRaw`
      INSERT INTO "knowledge_chunks" (id, "knowledgeBaseId", content, metadata, embedding, "tokenCount", "createdAt")
      VALUES (${randomUUID()}, ${knowledgeBaseId}, ${content}, '{}'::jsonb, ${`[${unit().join(",")}]`}::vector, 1, now())`;

  it("a sync run with a workspace base attached first still uses the caller's personal base", async () => {
    const user = await createUser(prisma);
    const plan = await createPlan(prisma);
    await createSubscription(prisma, { userId: user.id, planId: plan.id });
    await fundPaidWallet(prisma, user.id, "1");
    const workspace = await createWorkspace(prisma, { ownerId: user.id });
    const workspaceKb = await prisma.knowledgeBase.create({
      data: { userId: user.id, workspaceId: workspace.id, name: "Team KB" },
    });
    const personalKb = await prisma.knowledgeBase.create({ data: { userId: user.id, name: "My KB" } });
    await insertChunk(workspaceKb.id, "workspace base text");
    await insertChunk(personalKb.id, "personal base text");
    const agent = await createAgent(prisma, { userId: user.id, workspaceId: workspace.id });
    await prisma.agentKnowledgeBase.create({ data: { agentId: agent.id, knowledgeBaseId: workspaceKb.id } });
    await prisma.agentKnowledgeBase.create({ data: { agentId: agent.id, knowledgeBaseId: personalKb.id } });
    fake.enqueue({ content: "ok", usage: { prompt_tokens: 10, completion_tokens: 1 } });

    const res = await runs.chat(user.id, agent.id, "what do I know?");

    expect(res.message.content).toBe("ok");
    const prompt = JSON.stringify(fake.requests.at(-1)?.messages);
    expect(prompt).toContain("personal base text");
    expect(prompt).not.toContain("workspace base text");
    // The refused workspace base costs no embedding call: access is checked first
    expect(embedSingle).toHaveBeenCalledTimes(1);
  });

  it("RNX-116 review: another user's personal base attached to the agent: no chunk in the prompt and no embedding call", async () => {
    const runner = await createUser(prisma);
    const other = await createUser(prisma);
    const plan = await createPlan(prisma);
    await createSubscription(prisma, { userId: runner.id, planId: plan.id });
    await fundPaidWallet(prisma, runner.id, "1");
    const othersKb = await prisma.knowledgeBase.create({ data: { userId: other.id, name: "Not yours" } });
    await insertChunk(othersKb.id, "another user's private text");
    const agent = await createAgent(prisma, { userId: runner.id });
    // Attached directly: the attach route would refuse it, so this is the state a bypass or a stale row leaves.
    await prisma.agentKnowledgeBase.create({ data: { agentId: agent.id, knowledgeBaseId: othersKb.id } });
    fake.enqueue({ content: "ok", usage: { prompt_tokens: 10, completion_tokens: 1 } });

    const res = await runs.chat(runner.id, agent.id, "what do I know?");

    expect(res.message.content).toBe("ok");
    expect(JSON.stringify(fake.requests.at(-1)?.messages)).not.toContain("another user's private text");
    expect(embedSingle).not.toHaveBeenCalled();
  });

  /**
   * RX-116: a workspace of `owner` on a plan with this slug, a workspace base with one chunk, and a public agent of
   * the owner in that workspace with the base attached (as the owner attaches it). The owner has an active member
   * row; each extra member gets a row with the given status, a subscription and a funded wallet.
   */
  const workspaceAgentWithBase = async (planSlug: string, members: { status: "active" | "removed" }[]) => {
    const owner = await createUser(prisma);
    const plan = await createPlan(prisma, { slug: planSlug, maxWorkspaceUsers: 100 });
    await createSubscription(prisma, { userId: owner.id, planId: plan.id });
    await fundPaidWallet(prisma, owner.id, "1");
    const workspace = await createWorkspace(prisma, { ownerId: owner.id });
    await prisma.workspaceMember.create({
      data: { workspaceId: workspace.id, userId: owner.id, role: "owner", status: "active", joinedAt: new Date() },
    });
    const memberUsers = [];
    for (const { status } of members) {
      const user = await createUser(prisma);
      await createSubscription(prisma, { userId: user.id, planId: plan.id });
      await fundPaidWallet(prisma, user.id, "1");
      await prisma.workspaceMember.create({
        data: { workspaceId: workspace.id, userId: user.id, role: "member", status, joinedAt: new Date() },
      });
      memberUsers.push(user);
    }
    const workspaceKb = await prisma.knowledgeBase.create({
      data: { userId: owner.id, workspaceId: workspace.id, name: "Team KB" },
    });
    await insertChunk(workspaceKb.id, "workspace base text");
    const agent = await createAgent(prisma, {
      userId: owner.id,
      workspaceId: workspace.id,
      isPublic: true,
      status: "active",
    });
    await prisma.agentKnowledgeBase.create({ data: { agentId: agent.id, knowledgeBaseId: workspaceKb.id } });
    return { owner, members: memberUsers, workspace, agent };
  };

  const promptOfLastCall = () => JSON.stringify(fake.requests.at(-1)?.messages);

  it("RX-116 AC1: a current member of an Enterprise workspace running the owner's public agent gets the workspace base's chunk", async () => {
    const { members, agent } = await workspaceAgentWithBase("enterprise", [{ status: "active" }]);
    fake.enqueue({ content: "ok", usage: { prompt_tokens: 10, completion_tokens: 1 } });

    const res = await runs.chat(members[0].id, agent.id, "what does the team know?");

    expect(res.message.content).toBe("ok");
    expect(promptOfLastCall()).toContain("workspace base text");
    expect(embedSingle).toHaveBeenCalledTimes(1);
  });

  it("RX-116 AC2: a user removed from the Enterprise workspace gets no workspace chunk and spends no embedding call", async () => {
    const { members, agent } = await workspaceAgentWithBase("enterprise", [{ status: "removed" }]);
    fake.enqueue({ content: "ok", usage: { prompt_tokens: 10, completion_tokens: 1 } });

    const res = await runs.chat(members[0].id, agent.id, "what does the team know?");

    expect(res.message.content).toBe("ok");
    expect(promptOfLastCall()).not.toContain("workspace base text");
    expect(embedSingle).not.toHaveBeenCalled();
  });

  it.each(["starter", "pro"])(
    "RX-116 AC3: on a %s workspace the owner's run searches the workspace base",
    async (planSlug) => {
      const { owner, agent } = await workspaceAgentWithBase(planSlug, []);
      fake.enqueue({ content: "ok", usage: { prompt_tokens: 10, completion_tokens: 1 } });

      const res = await runs.chat(owner.id, agent.id, "what do I know?");

      expect(res.message.content).toBe("ok");
      expect(promptOfLastCall()).toContain("workspace base text");
      expect(embedSingle).toHaveBeenCalledTimes(1);
    },
  );

  it.each(["starter", "pro"])(
    "RX-116 AC3: on a %s workspace a stale active non-owner member row gets no workspace chunk and spends no embedding call",
    async (planSlug) => {
      const { members, agent } = await workspaceAgentWithBase(planSlug, [{ status: "active" }]);
      fake.enqueue({ content: "ok", usage: { prompt_tokens: 10, completion_tokens: 1 } });

      const res = await runs.chat(members[0].id, agent.id, "what does the team know?");

      expect(res.message.content).toBe("ok");
      expect(promptOfLastCall()).not.toContain("workspace base text");
      expect(embedSingle).not.toHaveBeenCalled();
    },
  );

  it("RX-116 AC4: a refused workspace base and an allowed personal base on one agent: the personal base is still searched", async () => {
    const { members, workspace } = await workspaceAgentWithBase("enterprise", [{ status: "removed" }]);
    const runner = members[0];
    const workspaceKb = await prisma.knowledgeBase.findFirstOrThrow({ where: { workspaceId: workspace.id } });
    const personalKb = await prisma.knowledgeBase.create({ data: { userId: runner.id, name: "My KB" } });
    await insertChunk(personalKb.id, "personal base text");
    const agent = await createAgent(prisma, { userId: runner.id, workspaceId: workspace.id });
    await prisma.agentKnowledgeBase.create({ data: { agentId: agent.id, knowledgeBaseId: workspaceKb.id } });
    await prisma.agentKnowledgeBase.create({ data: { agentId: agent.id, knowledgeBaseId: personalKb.id } });
    fake.enqueue({ content: "ok", usage: { prompt_tokens: 10, completion_tokens: 1 } });

    const res = await runs.chat(runner.id, agent.id, "what do I know?");

    expect(res.message.content).toBe("ok");
    expect(promptOfLastCall()).toContain("personal base text");
    expect(promptOfLastCall()).not.toContain("workspace base text");
    expect(embedSingle).toHaveBeenCalledTimes(1);
  });

  // RX-21 review B2: the usage log prices tokens per 1,000,000 at the tier rate (1/1/1 here). Since RX-22b the row is
  // written per model call with the credits its usage entry charged.
  it("a sync run logs 1,000 input + 500 output tokens at rate 1 as 0.0015 credits", async () => {
    const user = await createUser(prisma);
    const plan = await createPlan(prisma);
    await createSubscription(prisma, { userId: user.id, planId: plan.id });
    await fundPaidWallet(prisma, user.id, "1");
    const agent = await createAgent(prisma, { userId: user.id });
    fake.enqueue({ content: "ok", usage: { prompt_tokens: 1000, completion_tokens: 500 } });

    await runs.chat(user.id, agent.id, "hello");

    expect(logUsage).toHaveBeenCalledTimes(1);
    expect(logUsage.mock.calls[0][0]).toMatchObject({ inputTokens: 1000, outputTokens: 500 });
    expect(logUsage.mock.calls[0][0].cost.toString()).toBe("0.0015");
  });
});
