import { TestingModule } from "@nestjs/testing";
import { ChannelChatService } from "./channel-chat.service";
import { KnowledgeService } from "../../knowledge/service/knowledge.service";
import { WorkspaceKnowledgeService } from "../../workspace/service/workspace-knowledge.service";
import { ChannelService } from "./channel.service";
import { AgentToolService } from "../../agent/service/agent-tool.service";
import { AgentMemoryService } from "../../agent/service/agent-memory.service";
import { AgentRunMeterService } from "../../agent/service/agent-run-meter.service";
import { AgentRunPolicyService } from "../../agent/service/agent-run-policy.service";
import { AgentLinkService } from "../../agent/service/agent-link.service";
import { WorkspaceQuotaService } from "../../workspace/service/workspace-quota.service";
import { UsageService } from "../../usage/service/usage.service";
import { GuardrailService } from "../../guardrail/service/guardrail.service";
import { ModelRegistryService } from "../../config/model-registry.service";
import { CreditService } from "../../billing/service/credit.service";
import { PlatformSettingsService } from "../../offers/service/platform-settings.service";
import { ProvidersModule } from "../../providers/providers.module";
import { PrismaService } from "../../prisma/prisma.service";
import { UserRepository } from "../../auth/repository/user.repository";
import { createTestModule } from "../../../../test/test-module";
import { resetDatabase } from "../../../../test/test-database";
import { createAgent, createPackageSnapshot, createUser, createWorkspace } from "../../../../test/factories";
import { FakeProviderAdapter, withFakeProvider } from "../../../../test/fake-provider";
import { createResolvableModel } from "../../../../test/provider-model";
import { fundPaidWallet } from "../../../../test/credit-funding";

// RNX-335: the channel chat's (CH) system message asks for the runner's saved language (users.locale, D362) when it
// is a profile language other than the default "en"; otherwise it is the message main sent. The runner is the room's
// user who sent the message, never the agent owner. Real ChannelChatService, ChannelService, run policy, meter and
// ledger on the test database; fake provider. These collaborators load ESM-only packages.
jest.mock("../../knowledge/service/knowledge.service", () => ({ KnowledgeService: class {} }));
jest.mock("../../agent/service/agent-tool.service", () => ({ AgentToolService: class {} }));
jest.mock("../../guardrail/service/guardrail.service", () => ({ GuardrailService: class {} }));

const AGENT_PROMPT = "TEAM AGENT PROMPT";
const LANGUAGE_LINE_ID = "\n\nReply in the user's language (language code: id).";
/** The system message main sent for an agent with AGENT_PROMPT, no workspace memory, no callable agents and no document format. */
const MAIN_SYSTEM_MESSAGE = `${AGENT_PROMPT}\n\n## Memory Policy\nAfter completing an important task (creating documents, spreadsheets, setting up resources, etc.), use the memory_store tool to save key details (IDs, URLs, names, structure) so you can reference them in future conversations.`;

describe("RNX-335: the runner's reply language in a channel chat (test database, fake provider)", () => {
  const fake = new FakeProviderAdapter();
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let service: ChannelChatService;
  let channels: ChannelService;

  beforeAll(async () => {
    ({ moduleRef, prisma } = await createTestModule(
      {
        imports: [ProvidersModule],
        providers: [
          ChannelChatService,
          // RNX-24a: the knowledge of a channel run's called agents (RNX-121), unused here.
          { provide: KnowledgeService, useValue: {} },
          { provide: WorkspaceKnowledgeService, useValue: {} },
          ChannelService,
          AgentRunPolicyService,
          AgentLinkService,
          WorkspaceQuotaService,
          AgentRunMeterService,
          CreditService,
          PlatformSettingsService,
          ModelRegistryService,
          UsageService,
          { provide: AgentToolService, useValue: { buildToolSchemasWithMcp: async () => [], cleanupMcpConnections: async () => undefined } },
          { provide: AgentMemoryService, useValue: { getWorkspaceMemoryContext: async () => "", extractAndStore: async () => undefined } },
          {
            provide: GuardrailService,
            useValue: { checkInput: async () => ({ blocked: false }), checkOutput: async (content: string) => ({ blocked: false, content }) },
          },
        ],
      },
      (b) => withFakeProvider(b, fake),
    ));
    service = moduleRef.get(ChannelChatService);
    channels = moduleRef.get(ChannelService);
  });

  beforeEach(async () => {
    await resetDatabase(prisma);
    fake.requests.length = 0;
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

  /** The owner's workspace with an active agent (public when asked), and the runner's own channel with it added. */
  const seed = async ({ ownerLocale, isPublic = false }: { ownerLocale: string | null; isPublic?: boolean }) => {
    const owner = await payingUser(ownerLocale);
    const workspace = await createWorkspace(prisma, { ownerId: owner.id });
    const agent = await createAgent(prisma, { userId: owner.id, workspaceId: workspace.id, systemPrompt: AGENT_PROMPT, status: "active", isPublic });
    return { owner, agent };
  };

  const channelWithAgent = async (userId: string, agentId: string) => {
    const channel = await prisma.channel.create({ data: { userId, name: "My room" } });
    await channels.addAgent(userId, channel.id, agentId);
    return channel;
  };

  /** The system message of this runner's one-call channel chat. */
  const chatOnce = async (runnerId: string, channelId: string, agentId: string): Promise<string> => {
    fake.requests.length = 0;
    fake.enqueue({ content: "ok", usage: { prompt_tokens: 10, completion_tokens: 5 } });
    await service.chat(runnerId, channelId, agentId, "Hello");
    expect(fake.requests).toHaveLength(1);
    return String(fake.requests[0].messages[0].content);
  };

  it("AC1: a runner whose saved language is \"id\": the channel chat's system message ends with the language line for \"id\"", async () => {
    const { owner, agent } = await seed({ ownerLocale: "id" });
    const channel = await channelWithAgent(owner.id, agent.id);

    const actualSystemMessage = await chatOnce(owner.id, channel.id, agent.id);

    expect(actualSystemMessage).toBe(`${MAIN_SYSTEM_MESSAGE}${LANGUAGE_LINE_ID}`);
  });

  it("AC2: no saved language (null), the default \"en\", an empty value and a value that is not a profile language (\"fr\") send the system message main sent; \"id\" differs from it only by the line; the language is read once per message", async () => {
    const { owner, agent } = await seed({ ownerLocale: null });
    const channel = await channelWithAgent(owner.id, agent.id);
    const findLocale = jest.spyOn(moduleRef.get(UserRepository), "findLocale");
    const actualByLocale: Record<string, string> = {};

    for (const locale of [null, "en", "", "fr", "id"]) {
      await prisma.user.update({ where: { id: owner.id }, data: { locale } });
      actualByLocale[String(locale)] = await chatOnce(owner.id, channel.id, agent.id);
    }

    expect(actualByLocale).toEqual({
      null: MAIN_SYSTEM_MESSAGE,
      en: MAIN_SYSTEM_MESSAGE,
      "": MAIN_SYSTEM_MESSAGE,
      fr: MAIN_SYSTEM_MESSAGE,
      id: `${MAIN_SYSTEM_MESSAGE}${LANGUAGE_LINE_ID}`,
    });
    expect(findLocale).toHaveBeenCalledTimes(5);
  });

  it("the runner's language, never the agent owner's: an outsider chats with the owner's public agent in their own room", async () => {
    const { owner, agent } = await seed({ ownerLocale: "id", isPublic: true });
    const outsider = await payingUser(null);
    const channel = await channelWithAgent(outsider.id, agent.id);

    const outsiderWithoutLanguage = await chatOnce(outsider.id, channel.id, agent.id);
    await prisma.user.update({ where: { id: owner.id }, data: { locale: null } });
    await prisma.user.update({ where: { id: outsider.id }, data: { locale: "id" } });
    const outsiderWithLanguage = await chatOnce(outsider.id, channel.id, agent.id);

    expect(outsiderWithoutLanguage).toBe(MAIN_SYSTEM_MESSAGE);
    expect(outsiderWithLanguage).toBe(`${MAIN_SYSTEM_MESSAGE}${LANGUAGE_LINE_ID}`);
  });
});
