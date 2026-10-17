import { TestingModule } from "@nestjs/testing";
import { GowaService } from "./gowa.service";
import { PrismaService } from "../../prisma/prisma.service";
import { createTestModule } from "../../../../test/test-module";
import { resetDatabase } from "../../../../test/test-database";
import { createAgent, createUser } from "../../../../test/factories";

// RX-136: the channel lookup of the GOWA webhook (RX-115), written against the code before its query
// moved into AgentChannelRepository. Each saved channel below fails one condition of the lookup only
// (type, status, number), so the result is exactly the one channel that meets all three. Made-up numbers.
const TO = "628111000111";

describe("RX-136: GowaService.findWhatsappChannels (test database)", () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let service: GowaService;

  beforeAll(async () => {
    ({ moduleRef, prisma } = await createTestModule({ providers: [GowaService] }));
    service = moduleRef.get(GowaService);
  });

  beforeEach(() => resetDatabase(prisma));

  afterAll(() => moduleRef?.close());

  const saveChannel = async (channelType: string, status: string, phoneNumber: string) => {
    const user = await createUser(prisma);
    const agent = await createAgent(prisma, { userId: user.id });
    const channel = await prisma.agentChannel.create({
      data: { agentId: agent.id, channelType, status, config: { phoneNumber, webhookSecret: "made-up" } },
    });
    return { agent, channel };
  };

  it("finds only the active whatsapp channels of that number: not a paused one, not another type, not another number", async () => {
    const match = await saveChannel("whatsapp", "active", TO);
    await saveChannel("whatsapp", "paused", TO);
    await saveChannel("web", "active", TO);
    await saveChannel("whatsapp", "active", "628999000999");

    const actual = await service.findWhatsappChannels(TO);

    expect(actual.map(({ agent, channel }) => [agent.id, channel.id])).toEqual([[match.agent.id, match.channel.id]]);
  });

  it("each result carries the agent with its enabled tools, knowledge bases and connected integrations", async () => {
    const { agent } = await saveChannel("whatsapp", "active", TO);
    const enabled = await prisma.agentTool.create({ data: { agentId: agent.id, toolType: "web_search" } });
    await prisma.agentTool.create({ data: { agentId: agent.id, toolType: "calculator", enabled: false } });
    const connected = await prisma.agentIntegration.create({
      data: { agentId: agent.id, provider: "jira", config: {}, scopes: [] },
    });
    await prisma.agentIntegration.create({
      data: { agentId: agent.id, provider: "notion", config: {}, scopes: [], status: "revoked" },
    });

    const [actual] = await service.findWhatsappChannels(TO);

    expect(actual.agent).toBe(actual.channel.agent);
    expect(actual.agent).toMatchObject({ id: agent.id, userId: agent.userId, knowledgeBases: [] });
    expect(actual.agent.tools.map((t) => t.id)).toEqual([enabled.id]);
    expect(actual.agent.integrations.map((i) => i.id)).toEqual([connected.id]);
  });

  it.each([
    ["undefined", undefined],
    ["an empty string", ""],
    ["a number", 628111000111],
  ])("a `to` that is %s finds nothing", async (_name, toNumber) => {
    await saveChannel("whatsapp", "active", TO);

    expect(await service.findWhatsappChannels(toNumber)).toEqual([]);
  });
});
