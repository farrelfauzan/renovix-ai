import { TestingModule } from "@nestjs/testing";
import { AgentRunService } from "./agent-run.service";
import { AgentRunPolicyService } from "./agent-run-policy.service";
import { AgentLinkService } from "./agent-link.service";
import { AgentMemoryService } from "./agent-memory.service";
import { AgentRunMeterService } from "./agent-run-meter.service";
import { AgentToolService } from "./agent-tool.service";
import { McpClientService } from "../../mcp/service/mcp-client.service";
import { McpService } from "../../mcp/service/mcp.service";
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
import type { ChatRequest } from "../../providers/provider.interface";
import { PrismaService } from "../../prisma/prisma.service";
import { UserRepository } from "../../auth/repository/user.repository";
import { buildAgentRunSystemPrompt } from "../utils/build-agent-run-system-prompt";
import { createTestModule } from "../../../../test/test-module";
import { resetDatabase } from "../../../../test/test-database";
import { createAgent, createPackageSnapshot, createUser, createWorkspace } from "../../../../test/factories";
import { FakeProviderAdapter, withFakeProvider } from "../../../../test/fake-provider";
import { createResolvableModel } from "../../../../test/provider-model";
import { fundPaidWallet } from "../../../../test/credit-funding";
import { setPeerRunLimits } from "../../../../test/peer-run-limits";

// RNX-335: the agent run's (AR) system message asks for the runner's saved language (users.locale, D362) when it is a
// profile language other than the default "en"; otherwise it is the message main sent. The runner's, never the agent
// owner's; a called agent (hop) gets no line. Real AgentRunService, run policy, meter, ledger and provider router on
// the test database; fake LLM provider. These collaborators load ESM-only packages.
jest.mock("../../mcp/service/mcp-client.service", () => ({ McpClientService: class {} }));
jest.mock("../../mcp/service/mcp.service", () => ({ McpService: class {} }));
jest.mock("../../mcp/service/mcp-user.service", () => ({ McpUserService: class {} }));
jest.mock("../../mcp/service/web-search.service", () => ({ WebSearchService: class {} }));
jest.mock("../../document/service/document.service", () => ({ DocumentService: class {} }));
jest.mock("../../knowledge/service/knowledge.service", () => ({ KnowledgeService: class {} }));
jest.mock("../../guardrail/service/guardrail.service", () => ({ GuardrailService: class {} }));

const LANGUAGE_LINE_ID = "\n\nReply in the user's language (language code: id).";

describe("RNX-335: the runner's reply language in an agent run (test database, fake provider)", () => {
  const fake = new FakeProviderAdapter();
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
          AgentRunMeterService,
          CreditService,
          PlatformSettingsService,
          ModelRegistryService,
          UsageService,
          { provide: McpClientService, useValue: { connect: jest.fn(), close: jest.fn() } },
          { provide: McpService, useValue: {} },
          { provide: McpUserService, useValue: { getUserConnectedProviders: async () => new Map() } },
          { provide: WebSearchService, useValue: {} },
          { provide: DocumentService, useValue: {} },
          { provide: AgentMemoryService, useValue: { getMemoryContext: async () => "", extractAndStore: async () => undefined } },
          { provide: KnowledgeService, useValue: {} },
          { provide: WorkspaceKnowledgeService, useValue: { canSearchKnowledgeBase: async () => true, searchKnowledgeBase: async () => [] } },
          {
            provide: GuardrailService,
            useValue: { checkInput: async () => ({ blocked: false }), checkOutput: async (content: string) => ({ blocked: false, content }) },
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
    (fake as unknown as { turns: unknown[] }).turns.length = 0;
    await createResolvableModel(prisma, { slug: "test-model", modelName: "test-model", maxTokens: 8192 });
    await prisma.tierRate.create({ data: { tier: "standard", inputCreditsPerToken: 1, cachedCreditsPerToken: 1, outputCreditsPerToken: 1 } });
    await moduleRef.get(ModelRegistryService).refresh();
  });

  afterEach(() => jest.restoreAllMocks());

  afterAll(() => moduleRef?.close());

  /** A subscribed, funded user with this saved language. */
  const payingUser = async (locale: string | null) => {
    const user = await createUser(prisma, { locale });
    await createPackageSnapshot(prisma, { userId: user.id });
    await fundPaidWallet(prisma, user.id, "1");
    return user;
  };

  /** The owner's workspace with active agents "Agent <X>" (prompt "PROMPT <X>"), public when asked, and the links given as "AB". */
  const seed = async ({ ownerLocale, agents = ["A"], links = [], isPublic = false }: { ownerLocale: string | null; agents?: string[]; links?: string[]; isPublic?: boolean }) => {
    const owner = await payingUser(ownerLocale);
    const workspace = await createWorkspace(prisma, { ownerId: owner.id });
    const byName: Record<string, Awaited<ReturnType<typeof createAgent>>> = {};
    for (const name of agents) {
      byName[name] = await createAgent(prisma, { userId: owner.id, workspaceId: workspace.id, name: `Agent ${name}`, systemPrompt: `PROMPT ${name}`, status: "active", isPublic, maxTokens: 100 });
    }
    for (const [caller, callee] of links) {
      await prisma.agentLink.create({ data: { callerAgentId: byName[caller].id, calleeAgentId: byName[callee].id } });
    }
    return { owner, A: byName.A };
  };

  const systemMessageOf = (request: ChatRequest) => String(request.messages[0].content);

  /** The system message of this runner's one-call run of the agent (a new session each time). */
  const runOnce = async (runnerId: string, agentId: string): Promise<string> => {
    fake.requests.length = 0;
    fake.enqueue({ content: "ok", usage: { prompt_tokens: 10, completion_tokens: 5 } });
    await service.chat(runnerId, agentId, "Hello");
    expect(fake.requests).toHaveLength(1);
    return systemMessageOf(fake.requests[0]);
  };

  it("AC1: a runner whose saved language is \"id\": the agent run's system message ends with the language line for \"id\"", async () => {
    const { owner, A } = await seed({ ownerLocale: "id" });

    const actualSystemMessage = await runOnce(owner.id, A.id);

    expect(actualSystemMessage.endsWith(LANGUAGE_LINE_ID)).toBe(true);
  });

  it("AC2: no saved language (null), the default \"en\", an empty value and a value that is not a profile language (\"fr\") send the system message main sent; \"id\" differs from it only by the line", async () => {
    const { owner, A } = await seed({ ownerLocale: null });
    const expectedMainMessage = buildAgentRunSystemPrompt({ systemPrompt: "PROMPT A", callableAgents: [], knowledge: "", memory: "" });
    const actualByLocale: Record<string, string> = {};

    for (const locale of [null, "en", "", "fr", "id"]) {
      await prisma.user.update({ where: { id: owner.id }, data: { locale } });
      actualByLocale[String(locale)] = await runOnce(owner.id, A.id);
    }

    expect(actualByLocale).toEqual({
      null: expectedMainMessage,
      en: expectedMainMessage,
      "": expectedMainMessage,
      fr: expectedMainMessage,
      id: `${expectedMainMessage}${LANGUAGE_LINE_ID}`,
    });
  });

  it("a run whose reader is not the runner (the WhatsApp webhook) asks for no language, also when the runner saved \"id\"", async () => {
    const { owner, A } = await seed({ ownerLocale: "id" });
    fake.requests.length = 0;
    fake.enqueue({ content: "ok", usage: { prompt_tokens: 10, completion_tokens: 5 } });

    await service.chat(owner.id, A.id, "Hello", undefined, { isExternalAudience: true });

    expect(systemMessageOf(fake.requests[0])).not.toContain("Reply in the user's language");
  });

  it("the runner's language, never the agent owner's: an outsider runs the owner's public agent", async () => {
    const { owner, A } = await seed({ ownerLocale: "id", isPublic: true });
    const outsider = await payingUser(null);

    const outsiderWithoutLanguage = await runOnce(outsider.id, A.id);
    await prisma.user.update({ where: { id: owner.id }, data: { locale: null } });
    await prisma.user.update({ where: { id: outsider.id }, data: { locale: "id" } });
    const outsiderWithLanguage = await runOnce(outsider.id, A.id);

    expect(outsiderWithoutLanguage).not.toContain("Reply in the user's language");
    expect(outsiderWithLanguage.endsWith(LANGUAGE_LINE_ID)).toBe(true);
  });

  it("A calls B: every call of A carries the runner's line, B's system message (a hop) has none, and the language is read once for the run", async () => {
    await setPeerRunLimits(prisma, { maxDepth: 1, maxAgentCalls: 3, callTimeoutSeconds: 30 });
    const { owner, A } = await seed({ ownerLocale: "id", agents: ["A", "B"], links: ["AB"] });
    const findLocale = jest.spyOn(moduleRef.get(UserRepository), "findLocale");
    fake.enqueue(
      { toolCalls: [{ name: "call_agent", arguments: { agent: "Agent B", task: "summarise the notes" } }], usage: { prompt_tokens: 10, completion_tokens: 5 } },
      { content: "B answer", usage: { prompt_tokens: 10, completion_tokens: 5 } },
      { content: "A final", usage: { prompt_tokens: 10, completion_tokens: 5 } },
    );

    const result = await service.chat(owner.id, A.id, "Hello");

    expect(result.message.content).toBe("A final");
    const systemMessages = fake.requests.map(systemMessageOf);
    expect(systemMessages).toHaveLength(3);
    expect(systemMessages[0].endsWith(LANGUAGE_LINE_ID)).toBe(true);
    expect(systemMessages[1]).toBe("PROMPT B");
    expect(systemMessages[2]).toBe(systemMessages[0]);
    expect(findLocale).toHaveBeenCalledTimes(1);
  });
});
