import { TestingModule } from "@nestjs/testing";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { AgentRunService } from "./agent-run.service";
import { AgentRunPolicyService } from "./agent-run-policy.service";
import { AgentRunMeterService } from "./agent-run-meter.service";
import { AgentToolService } from "./agent-tool.service";
import { AgentMemoryService } from "./agent-memory.service";
import { AgentLinkService } from "./agent-link.service";
import { McpClientService } from "../../mcp/service/mcp-client.service";
import { McpService } from "../../mcp/service/mcp.service";
import { McpRegistryService } from "../../mcp/service/mcp-registry.service";
import { McpUserService } from "../../mcp/service/mcp-user.service";
import { WebSearchService } from "../../mcp/service/web-search.service";
import { DocumentService } from "../../document/service/document.service";
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
import { createAgent, createPlan, createSubscription, createUser, createWorkspace } from "../../../../test/factories";
import { FakeProviderAdapter, withFakeProvider } from "../../../../test/fake-provider";
import { createResolvableModel } from "../../../../test/provider-model";
import { fundPaidWallet } from "../../../../test/credit-funding";

// RNX-119 (D257) AC6: in a collaborator's run of a workspace agent, the MCP tools resolve from the collaborator's own
// account only; the workspace owner's MCP credential is never read. Real AgentRunService, run policy, AgentToolService,
// McpService and McpClientService on the test database, fake LLM provider. The credential lookup
// (McpUserService.getUserConnectedProviders) is a spy over each user's connected providers; a "connected" provider is
// the local stub stdio server (apps/api/test/mcp-stub-server.mjs), which records whose server answered. No network.
// The modules mocked below load ESM-only packages.
jest.mock("../../mcp/service/mcp-user.service", () => ({ McpUserService: class {} }));
jest.mock("../../mcp/service/web-search.service", () => ({ WebSearchService: class {} }));
jest.mock("../../document/service/document.service", () => ({ DocumentService: class {} }));
jest.mock("../../knowledge/service/knowledge.service", () => ({ KnowledgeService: class {} }));
jest.mock("../../guardrail/service/guardrail.service", () => ({ GuardrailService: class {} }));

const STUB_SERVER = resolve(__dirname, "../../../../test/mcp-stub-server.mjs");

describe("RNX-119 AC6: a collaborator's run uses the collaborator's MCP credentials only (test database, stub MCP server)", () => {
  const fake = new FakeProviderAdapter();
  /** Each user's connected providers, as McpUserService would decrypt them: the stub's env. */
  const connectedProviders = new Map<string, Map<string, Record<string, string>>>();
  const getUserConnectedProviders = jest.fn(
    async (userId: string, _workspaceId: string) => connectedProviders.get(userId) ?? new Map(),
  );
  let recordDir: string;
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let service: AgentRunService;

  beforeAll(async () => {
    ({ moduleRef, prisma } = await createTestModule(
      {
        imports: [ProvidersModule],
        providers: [
          AgentRunService,
          AgentRunPolicyService,
          AgentLinkService,
          WorkspaceQuotaService,
          AgentToolService,
          McpClientService,
          McpService,
          McpRegistryService,
          AgentRunMeterService,
          CreditService,
          PlatformSettingsService,
          ModelRegistryService,
          UsageService,
          { provide: McpUserService, useValue: { getUserConnectedProviders } },
          { provide: WebSearchService, useValue: {} },
          { provide: DocumentService, useValue: {} },
          {
            provide: AgentMemoryService,
            useValue: { getMemoryContext: async () => "", extractAndStore: async () => undefined },
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
    service = moduleRef.get(AgentRunService);
  });

  beforeEach(async () => {
    await resetDatabase(prisma);
    fake.requests.length = 0;
    connectedProviders.clear();
    getUserConnectedProviders.mockClear();
    recordDir = mkdtempSync(join(tmpdir(), "rnx119-stub-records-"));
    await createResolvableModel(prisma, { slug: "test-model", modelName: "test-model", maxTokens: 8192 });
    await prisma.tierRate.create({
      data: { tier: "standard", inputCreditsPerToken: 1, cachedCreditsPerToken: 1, outputCreditsPerToken: 1 },
    });
    await moduleRef.get(ModelRegistryService).refresh();
    // The real config (id `${provider}-${userId}`, the user's env); only the command runs the local stub.
    const mcpService = moduleRef.get(McpService);
    const buildConfig = mcpService.buildConfigFromProvider.bind(mcpService);
    jest.spyOn(mcpService, "buildConfigFromProvider").mockImplementation((provider, env, userId) => {
      const config = buildConfig(provider, env, userId);
      return config && { ...config, command: process.execPath, args: [STUB_SERVER] };
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
    rmSync(recordDir, { recursive: true, force: true });
  });

  afterAll(() => moduleRef?.close());

  /** A subscribed user funded with 1 credit, on a plan with this slug. */
  const newUser = async (planSlug?: string) => {
    const user = await createUser(prisma);
    const plan = await createPlan(prisma, planSlug ? { slug: planSlug } : {});
    await createSubscription(prisma, { userId: user.id, planId: plan.id });
    await fundPaidWallet(prisma, user.id, "1");
    return user;
  };

  /** Connects "github" for this user: the stub server named `name`, recording into its own file. */
  const connectGithub = (userId: string, name: string) =>
    connectedProviders.set(
      userId,
      new Map([["github", { MCP_STUB_OWNER: name, MCP_STUB_RECORD_FILE: join(recordDir, `${name}.jsonl`) }]]),
    );

  /** An Enterprise owner's shared workspace with an agent, the owner's github connected, and an active collaborator. */
  const seed = async () => {
    const owner = await newUser("enterprise");
    const workspace = await createWorkspace(prisma, { ownerId: owner.id });
    const agent = await createAgent(prisma, { userId: owner.id, workspaceId: workspace.id, status: "active" });
    const collaborator = await newUser();
    await prisma.workspaceMember.create({
      data: { workspaceId: workspace.id, userId: collaborator.id, role: "member", status: "active", joinedAt: new Date() },
    });
    connectGithub(owner.id, "owner");
    return { owner, workspace, agent, collaborator };
  };

  /** What the stub server of `name` recorded: one "started" per connection and one "call" per tool call. */
  const records = (name: string): { event: string }[] => {
    const file = join(recordDir, `${name}.jsonl`);
    if (!existsSync(file)) return [];
    return readFileSync(file, "utf8").trim().split("\n").map((line) => JSON.parse(line));
  };

  const offeredTools = () => (fake.requests[0].tools ?? []).map((t: any) => t.function.name);

  it("the owner has connected a tool and the collaborator has not: the owner's credential is never read or used", async () => {
    const { workspace, agent, collaborator } = await seed();
    fake.enqueue({ content: "No tools here" });

    const result = await service.chat(collaborator.id, agent.id, "Who answers?");

    expect(result.message.content).toBe("No tools here");
    expect(getUserConnectedProviders.mock.calls).toEqual([[collaborator.id, workspace.id]]);
    expect(offeredTools()).not.toContain("whoami");
    expect(records("owner")).toEqual([]);
  });

  it("the collaborator has connected it: the tool runs on the collaborator's own server, never the owner's", async () => {
    const { workspace, agent, collaborator } = await seed();
    connectGithub(collaborator.id, "collaborator");
    fake.enqueue({ toolCalls: [{ name: "whoami", arguments: { caller: "run" } }] }, { content: "Done" });

    await service.chat(collaborator.id, agent.id, "Who answers?");

    expect(getUserConnectedProviders.mock.calls).toEqual([[collaborator.id, workspace.id]]);
    expect(offeredTools()).toContain("whoami");
    const toolResults = (fake.requests[1].messages as { role: string; content: unknown }[]).filter((m) => m.role === "tool");
    expect(toolResults.map((m) => m.content)).toEqual(["answered by collaborator"]);
    expect(records("collaborator").map((r) => r.event)).toEqual(["started", "call"]);
    expect(records("owner")).toEqual([]);
  });

  it("the owner's own run uses the owner's server (control: the stub and the spy see an owner run)", async () => {
    const { owner, workspace, agent } = await seed();
    fake.enqueue({ toolCalls: [{ name: "whoami", arguments: { caller: "run" } }] }, { content: "Done" });

    await service.chat(owner.id, agent.id, "Who answers?");

    expect(getUserConnectedProviders.mock.calls).toEqual([[owner.id, workspace.id]]);
    expect(records("owner").map((r) => r.event)).toEqual(["started", "call"]);
  });
});
