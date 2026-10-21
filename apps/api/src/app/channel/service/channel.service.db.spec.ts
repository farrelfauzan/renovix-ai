import { NotFoundException } from "@nestjs/common";
import { TestingModule } from "@nestjs/testing";
import { ChannelService } from "./channel.service";
import { AgentRunPolicyService } from "../../agent/service/agent-run-policy.service";
import { WorkspaceQuotaService } from "../../workspace/service/workspace-quota.service";
import { PrismaService } from "../../prisma/prisma.service";
import { createTestModule } from "../../../../test/test-module";
import { resetDatabase } from "../../../../test/test-database";
import { createAgent, createUser } from "../../../../test/factories";

// RX-136: the ChannelService methods that only the channel chat run path (ChannelChatService, RX-24)
// calls, so no route reaches them without a model: attaching a generated document to a message,
// saving a message, resolving the channel agent with its tools and integrations, and the general
// room. Written against the code before its queries moved into repositories. Test database.
describe("RX-136: ChannelService (test database)", () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let service: ChannelService;

  beforeAll(async () => {
    ({ moduleRef, prisma } = await createTestModule({ providers: [ChannelService, AgentRunPolicyService, WorkspaceQuotaService] }));
    service = moduleRef.get(ChannelService);
  });

  beforeEach(() => resetDatabase(prisma));

  afterAll(() => moduleRef?.close());

  const document = { format: "pdf", url: "https://files.invalid/a.pdf", filename: "a.pdf", expiresAt: "2026-12-01" };

  const createChannel = (userId: string, name: string) => prisma.channel.create({ data: { userId, name } });
  const link = (channelId: string, agentId: string) => prisma.channelAgent.create({ data: { channelId, agentId } });
  const room = (channelId: string) => prisma.channelChatRoom.create({ data: { channelId, name: "general" } });
  const message = (chatRoomId: string, agentId: string, content: string, role: string) =>
    prisma.channelMessage.create({ data: { chatRoomId, agentId, content, role } });
  const snapshot = async () =>
    (await prisma.channelMessage.findMany({ orderBy: { content: "asc" } })).map((m) => ({
      content: m.content,
      metadata: m.metadata,
    }));

  describe("attachDocumentToMessage", () => {
    // Channel A has agents X and Y; X is also in channel C. Each message below fails one condition only.
    const setup = async () => {
      const alice = await createUser(prisma);
      const agentX = await createAgent(prisma, { userId: alice.id });
      const agentY = await createAgent(prisma, { userId: alice.id });
      const channelA = await createChannel(alice.id, "A");
      await link(channelA.id, agentX.id);
      await link(channelA.id, agentY.id);
      const roomA = await room(channelA.id);
      const channelC = await createChannel(alice.id, "C");
      await link(channelC.id, agentX.id);
      const roomC = await room(channelC.id);
      const target = await message(roomA.id, agentX.id, "a-x-assistant", "assistant");
      const sibling = await message(roomA.id, agentX.id, "a-x-assistant-2", "assistant");
      const userRole = await message(roomA.id, agentX.id, "a-x-user", "user");
      const otherAgent = await message(roomA.id, agentY.id, "a-y-assistant", "assistant");
      const otherRoom = await message(roomC.id, agentX.id, "c-x-assistant", "assistant");
      return { alice, agentX, channelA, target, sibling, userRole, otherAgent, otherRoom };
    };

    it("sets the content and the document of that assistant message only", async () => {
      const { alice, agentX, channelA, target } = await setup();

      await service.attachDocumentToMessage(alice.id, channelA.id, agentX.id, target.id, "Summary", document);

      expect(await snapshot()).toEqual([
        { content: "a-x-assistant-2", metadata: null },
        { content: "a-x-user", metadata: null },
        { content: "a-y-assistant", metadata: null },
        { content: "c-x-assistant", metadata: null },
        { content: "Summary", metadata: { document } },
      ]);
    });

    it.each([
      ["a user message", "userRole"],
      ["another agent's message of the same room", "otherAgent"],
      ["the same agent's message in another channel's room", "otherRoom"],
    ] as const)("changes nothing for %s", async (_name, key) => {
      const rows = await setup();
      const before = await snapshot();

      await service.attachDocumentToMessage(rows.alice.id, rows.channelA.id, rows.agentX.id, rows[key].id, "Summary", document);

      expect(await snapshot()).toEqual(before);
    });
  });

  describe("saveMessage", () => {
    it("stores the message in the general room of the link's channel, for the link's agent", async () => {
      const alice = await createUser(prisma);
      const agentX = await createAgent(prisma, { userId: alice.id });
      const channelA = await createChannel(alice.id, "A");
      const channelAgent = await link(channelA.id, agentX.id);

      const plain = await service.saveMessage(channelAgent.id, alice.id, { role: "user", content: "hi" });
      const withMeta = await service.saveMessage(channelAgent.id, alice.id, {
        role: "assistant",
        content: "hello",
        tokens: 12,
        cost: 0.5,
        metadata: { document },
      });

      const rooms = await prisma.channelChatRoom.findMany();
      expect(rooms.map((r) => [r.channelId, r.name])).toEqual([[channelA.id, "general"]]);
      expect(plain).toMatchObject({ chatRoomId: rooms[0].id, agentId: agentX.id, role: "user", content: "hi", tokens: null, metadata: null });
      expect(withMeta).toMatchObject({ chatRoomId: rooms[0].id, agentId: agentX.id, tokens: 12, metadata: { document } });
      expect(withMeta.cost?.toString()).toBe("0.5");
    });

    it("an unknown link: NotFoundException, nothing stored", async () => {
      await expect(
        service.saveMessage("00000000-0000-4000-8000-000000000000", "u", { role: "user", content: "hi" }),
      ).rejects.toThrow(new NotFoundException("Channel agent not found"));
      expect(await prisma.channelMessage.count()).toBe(0);
    });
  });

  describe("resolveChannelAgent", () => {
    it("returns the link with the channel's workspace and the agent's enabled tools, knowledge bases and connected integrations", async () => {
      const alice = await createUser(prisma);
      const agentX = await createAgent(prisma, { userId: alice.id });
      const channelA = await createChannel(alice.id, "A");
      const channelAgent = await link(channelA.id, agentX.id);
      const enabled = await prisma.agentTool.create({ data: { agentId: agentX.id, toolType: "web_search" } });
      await prisma.agentTool.create({ data: { agentId: agentX.id, toolType: "calculator", enabled: false } });
      const connected = await prisma.agentIntegration.create({
        data: { agentId: agentX.id, provider: "jira", config: {}, scopes: [] },
      });
      await prisma.agentIntegration.create({
        data: { agentId: agentX.id, provider: "notion", config: {}, scopes: [], status: "expired" },
      });

      const actual = await service.resolveChannelAgent(alice.id, channelA.id, agentX.id);

      expect(actual.id).toBe(channelAgent.id);
      expect(actual.channel).toMatchObject({ id: channelA.id, workspace: null });
      expect(actual.agent.tools.map((t) => t.id)).toEqual([enabled.id]);
      expect(actual.agent.integrations.map((i) => i.id)).toEqual([connected.id]);
      expect(actual.agent.knowledgeBases).toEqual([]);
    });

    it("another user's channel: NotFoundException", async () => {
      const alice = await createUser(prisma);
      const bob = await createUser(prisma);
      const agentX = await createAgent(prisma, { userId: alice.id });
      const channelA = await createChannel(alice.id, "A");
      await link(channelA.id, agentX.id);

      await expect(service.resolveChannelAgent(bob.id, channelA.id, agentX.id)).rejects.toThrow(
        new NotFoundException("Channel not found"),
      );
    });
  });

  describe("getOrCreateChatRoom", () => {
    it("creates the general room once and returns it after", async () => {
      const alice = await createUser(prisma);
      const channelA = await createChannel(alice.id, "A");

      const first = await service.getOrCreateChatRoom(channelA.id);
      const second = await service.getOrCreateChatRoom(channelA.id);

      expect(second.id).toBe(first.id);
      expect(first).toMatchObject({ channelId: channelA.id, name: "general" });
      expect(await prisma.channelChatRoom.count()).toBe(1);
    });
  });
});
