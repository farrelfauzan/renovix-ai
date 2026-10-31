import { TestingModule } from "@nestjs/testing";
import { AgentToolService } from "./agent-tool.service";
import { McpClientService } from "../../mcp/service/mcp-client.service";
import { McpService } from "../../mcp/service/mcp.service";
import { McpUserService } from "../../mcp/service/mcp-user.service";
import { WebSearchService } from "../../mcp/service/web-search.service";
import { AgentMemoryService } from "./agent-memory.service";
import { DocumentService } from "../../document/service/document.service";
import { PrismaService } from "../../prisma/prisma.service";
import { createTestModule } from "../../../../test/test-module";
import { resetDatabase } from "../../../../test/test-database";
import { createAgent, createUser } from "../../../../test/factories";

// RX-133: the create_reminder tool's database writes (find or create the channel's "general" room,
// then the reminder), written against the code before they moved into repositories. Test database;
// the other dependencies are stubs, as in agent-tool.service.spec.ts (their modules load ESM packages).
jest.mock("../../mcp/service/mcp-client.service", () => ({ McpClientService: class {} }));
jest.mock("../../mcp/service/mcp.service", () => ({ McpService: class {} }));
jest.mock("../../mcp/service/mcp-user.service", () => ({ McpUserService: class {} }));
jest.mock("../../mcp/service/web-search.service", () => ({ WebSearchService: class {} }));
jest.mock("./agent-memory.service", () => ({ AgentMemoryService: class {} }));
jest.mock("../../document/service/document.service", () => ({ DocumentService: class {} }));
jest.mock("../../providers/provider-router", () => ({ ProviderRouter: class {} }));

type CreateReminder = (args: object, agent: object, userId?: string, channelId?: string) => Promise<string>;

describe("RX-133: create_reminder tool (test database)", () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let service: AgentToolService;

  beforeAll(async () => {
    ({ moduleRef, prisma } = await createTestModule({
      providers: [
        AgentToolService,
        ...[McpClientService, McpService, McpUserService, WebSearchService, AgentMemoryService, DocumentService].map(
          (provide) => ({ provide, useValue: {} }),
        ),
      ],
    }));
    service = moduleRef.get(AgentToolService);
  });

  beforeEach(() => resetDatabase(prisma));

  afterAll(() => moduleRef?.close());

  // Called directly: executeTool races it against a 30 s timer that would keep Jest open.
  const createReminder: CreateReminder = (...args) =>
    (service as unknown as { executeCreateReminder: CreateReminder }).executeCreateReminder(...args);

  const setup = async () => {
    const user = await createUser(prisma);
    const agent = await createAgent(prisma, { userId: user.id });
    const channel = await prisma.channel.create({ data: { userId: user.id, name: "Team" } });
    return { user, agent, channel };
  };

  const args = { prompt: "Summarise expenses", cronExpression: "0 8 * * *", description: "Daily summary", timezone: "Asia/Jakarta" };

  it("creates the channel's general room when there is none, then the reminder", async () => {
    const { user, agent, channel } = await setup();

    const result = await createReminder(args, agent, user.id, channel.id);

    const reminder = await prisma.reminder.findFirstOrThrow();
    const room = await prisma.channelChatRoom.findFirstOrThrow();
    expect(result).toMatch(/^Successfully created reminder "Daily summary"\. Next execution: .+ \(Asia\/Jakarta\)\. Reminder ID: /);
    expect(result).toContain(reminder.id);
    expect(room).toMatchObject({ channelId: channel.id, name: "general" });
    expect(reminder).toMatchObject({
      userId: user.id,
      agentId: agent.id,
      channelId: channel.id,
      chatRoomId: room.id,
      prompt: "Summarise expenses",
      description: "Daily summary",
      cronExpression: "0 8 * * *",
      timezone: "Asia/Jakarta",
      status: "ACTIVE",
    });
    expect(reminder.nextRunAt.getTime()).toBeGreaterThan(Date.now());
  });

  it("reuses this channel's general room; another channel's room or another name does not count", async () => {
    const { user, agent, channel } = await setup();
    const otherChannel = await prisma.channel.create({ data: { userId: user.id, name: "Other" } });
    await prisma.channelChatRoom.create({ data: { channelId: otherChannel.id, name: "general" } });
    await prisma.channelChatRoom.create({ data: { channelId: channel.id, name: "random" } });
    const general = await prisma.channelChatRoom.create({ data: { channelId: channel.id, name: "general" } });

    await createReminder({ prompt: "Ping", cronExpression: "*/5 * * * *" }, agent, user.id, channel.id);

    expect(await prisma.channelChatRoom.count()).toBe(3);
    expect(await prisma.reminder.findFirstOrThrow()).toMatchObject({ chatRoomId: general.id, description: null, timezone: "UTC" });
  });

  // RNX-33: without a timezone the tool uses the user's saved one (the profile step); UTC when none is saved.
  it.each([
    ["the saved timezone, without one given", "Asia/Jakarta", undefined, "Asia/Jakarta"],
    ["the given timezone over the saved one", "Asia/Jakarta", "Europe/Berlin", "Europe/Berlin"],
    ["UTC, without one given or saved", null, undefined, "UTC"],
  ] as const)("RNX-33: %s", async (_name, saved, given, expected) => {
    const { agent, channel } = await setup();
    const user = await prisma.user.update({ where: { id: channel.userId }, data: { timezone: saved } });

    const result = await createReminder({ prompt: "Ping", cronExpression: "0 8 * * *", timezone: given }, agent, user.id, channel.id);

    expect(result).toContain(`(${expected})`);
    expect((await prisma.reminder.findFirstOrThrow()).timezone).toBe(expected);
  });

  it.each([
    ["no user", undefined, "channel", "Error: Unable to create reminder — user context unavailable."],
    ["no channel", "user", undefined, "Error: Unable to create reminder — channel context unavailable."],
  ] as const)("%s: an error text, nothing written", async (_name, withUser, withChannel, expected) => {
    const { user, agent, channel } = await setup();

    const result = await createReminder(args, agent, withUser && user.id, withChannel && channel.id);

    expect(result).toBe(expected);
    expect(await prisma.channelChatRoom.count()).toBe(0);
    expect(await prisma.reminder.count()).toBe(0);
  });

  it("an invalid cron expression: an error text, nothing written", async () => {
    const { user, agent, channel } = await setup();

    const result = await createReminder({ ...args, cronExpression: "not a cron" }, agent, user.id, channel.id);

    expect(result).toMatch(/^Error: Invalid cron expression "not a cron"\./);
    expect(await prisma.channelChatRoom.count()).toBe(0);
  });

  // The two writes were never one transaction: a reminder that fails leaves the new room behind.
  it("the reminder write fails (unknown agent): a 'Failed to create reminder' text, the new room stays", async () => {
    const { user, channel } = await setup();

    const result = await createReminder(args, { id: "00000000-0000-4000-8000-000000000000" }, user.id, channel.id);

    expect(result).toMatch(/^Failed to create reminder: /);
    expect(await prisma.reminder.count()).toBe(0);
    expect(await prisma.channelChatRoom.count({ where: { channelId: channel.id, name: "general" } })).toBe(1);
  });
});
