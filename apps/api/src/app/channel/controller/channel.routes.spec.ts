import { TestingModule } from "@nestjs/testing";
import { NestFastifyApplication } from "@nestjs/platform-fastify";
import * as jwt from "jsonwebtoken";
import { ChannelController } from "./channel.controller";
import { ChannelService } from "../service/channel.service";
import { ChannelChatService } from "../service/channel-chat.service";
import { S3Service } from "../../knowledge/service/s3.service";
import { DocumentService } from "../../document/service/document.service";
import { AgentToolService } from "../../agent/service/agent-tool.service";
import { ProviderRouter } from "../../providers/provider-router";
import { PrismaService } from "../../prisma/prisma.service";
import { createFastifyApp, createTestModule } from "../../../../test/test-module";
import { resetDatabase } from "../../../../test/test-database";
import { createAgent, createUser } from "../../../../test/factories";

// RX-136: the channel routes and conditions that the ownership suite (RX-15, channel.ownership.spec.ts)
// does not cover, written against the code before its queries moved into repositories. Each test
// leaves exactly one condition of a query to decide the result: a caller who owns a channel of their
// own (so only the channel id refuses), an agent linked to another channel of the same owner (so only
// the channel id of the link refuses), another agent of the same room, and so on. Real controller and
// ChannelService, test database; the chat, upload and document collaborators are not used here.
jest.mock("../../../lib/auth", () => ({ auth: { api: { getSession: async () => null } } }));
jest.mock("../service/channel-chat.service", () => ({ ChannelChatService: class {} }));
jest.mock("../../knowledge/service/s3.service", () => ({ S3Service: class {} }));
jest.mock("../../document/service/document.service", () => ({ DocumentService: class {} }));
jest.mock("../../agent/service/agent-tool.service", () => ({ AgentToolService: class {} }));

process.env.JWT_SECRET = "rx136-test-jwt-secret";

describe("RX-136: channel routes (Fastify, test database)", () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let app: NestFastifyApplication;

  beforeAll(async () => {
    ({ moduleRef, prisma } = await createTestModule({
      controllers: [ChannelController],
      providers: [
        ChannelService,
        { provide: ChannelChatService, useValue: {} },
        { provide: S3Service, useValue: {} },
        { provide: DocumentService, useValue: {} },
        { provide: AgentToolService, useValue: {} },
        { provide: ProviderRouter, useValue: {} },
      ],
    }));
    app = await createFastifyApp(moduleRef);
  });

  beforeEach(() => resetDatabase(prisma));

  afterAll(() => app?.close());

  const auth = (user: { id: string; email: string }) => ({
    authorization: `Bearer ${jwt.sign({ userId: user.id, email: user.email }, process.env.JWT_SECRET!)}`,
  });

  const createChannel = (userId: string, name: string) => prisma.channel.create({ data: { userId, name } });
  const link = (channelId: string, agentId: string) => prisma.channelAgent.create({ data: { channelId, agentId } });
  const room = (channelId: string, name = "general") => prisma.channelChatRoom.create({ data: { channelId, name } });
  const message = (chatRoomId: string, agentId: string, content: string, role = "user") =>
    prisma.channelMessage.create({ data: { chatRoomId, agentId, content, role } });
  const contents = async () =>
    (await prisma.channelMessage.findMany({ orderBy: { content: "asc" } })).map((m) => m.content);

  // Alice owns channel A with agent X; Bob owns a channel of his own with his agent.
  const setup = async () => {
    const alice = await createUser(prisma);
    const bob = await createUser(prisma);
    const agentX = await createAgent(prisma, { userId: alice.id });
    const channelA = await createChannel(alice.id, "Alice channel");
    await link(channelA.id, agentX.id);
    const roomA = await room(channelA.id);
    await message(roomA.id, agentX.id, "alice-x-1");
    const bobAgent = await createAgent(prisma, { userId: bob.id });
    const bobChannel = await createChannel(bob.id, "Bob channel");
    await link(bobChannel.id, bobAgent.id);
    return { alice, bob, agentX, channelA, roomA, bobAgent, bobChannel };
  };

  describe("a caller who owns a channel of their own still cannot reach another user's channel (the channel id decides)", () => {
    it("GET /channels/:id is 404", async () => {
      const { bob, channelA } = await setup();

      const res = await app.inject({ method: "GET", url: `/channels/${channelA.id}`, headers: auth(bob) });

      expect(res.statusCode).toBe(404);
    });

    it("PATCH /channels/:id is 404, both channels unchanged", async () => {
      const { bob, channelA, bobChannel } = await setup();

      const res = await app.inject({
        method: "PATCH",
        url: `/channels/${channelA.id}`,
        headers: auth(bob),
        payload: { name: "Renamed by bob" },
      });

      expect(res.statusCode).toBe(404);
      expect((await prisma.channel.findMany({ orderBy: { name: "asc" } })).map((c) => c.id)).toEqual([
        channelA.id,
        bobChannel.id,
      ]);
      expect((await prisma.channel.findMany()).map((c) => c.name).sort()).toEqual(["Alice channel", "Bob channel"]);
    });

    it("DELETE /channels/:id is 404, the channel kept", async () => {
      const { bob, channelA } = await setup();

      const res = await app.inject({ method: "DELETE", url: `/channels/${channelA.id}`, headers: auth(bob) });

      expect(res.statusCode).toBe(404);
      expect(await prisma.channel.count({ where: { id: channelA.id } })).toBe(1);
    });

    it("POST /channels/:id/agents is 404, no link added", async () => {
      const { bob, channelA, agentX, bobAgent } = await setup();

      const res = await app.inject({
        method: "POST",
        url: `/channels/${channelA.id}/agents`,
        headers: auth(bob),
        payload: { agentId: bobAgent.id },
      });

      expect(res.statusCode).toBe(404);
      const links = await prisma.channelAgent.findMany({ where: { channelId: channelA.id } });
      expect(links.map((l) => l.agentId)).toEqual([agentX.id]);
    });

    it("DELETE /channels/:id/agents/:agentId is 404, the link and its messages kept", async () => {
      const { bob, channelA, agentX } = await setup();

      const res = await app.inject({
        method: "DELETE",
        url: `/channels/${channelA.id}/agents/${agentX.id}`,
        headers: auth(bob),
      });

      expect(res.statusCode).toBe(404);
      expect(await prisma.channelAgent.count({ where: { channelId: channelA.id } })).toBe(1);
      expect(await contents()).toEqual(["alice-x-1"]);
    });

    it("GET /channels/:id/agents/:agentId/messages is 404, nothing of Alice's in the body", async () => {
      const { bob, channelA, agentX } = await setup();

      const res = await app.inject({
        method: "GET",
        url: `/channels/${channelA.id}/agents/${agentX.id}/messages`,
        headers: auth(bob),
      });

      expect(res.statusCode).toBe(404);
      expect(res.body).not.toContain("alice-x-1");
    });

    it("DELETE /channels/:id/agents/:agentId/messages is 404, the messages kept", async () => {
      const { bob, channelA, agentX } = await setup();

      const res = await app.inject({
        method: "DELETE",
        url: `/channels/${channelA.id}/agents/${agentX.id}/messages`,
        headers: auth(bob),
      });

      expect(res.statusCode).toBe(404);
      expect(await contents()).toEqual(["alice-x-1"]);
    });
  });

  describe("POST /channels/:id/agents: which agent may be added", () => {
    it("the owner adds their own private draft agent: 201, the link with the agent's public fields", async () => {
      const { alice, channelA } = await setup();
      const own = await createAgent(prisma, { userId: alice.id, avatar: "a.png", avatarColor: "#111111" });

      const res = await app.inject({
        method: "POST",
        url: `/channels/${channelA.id}/agents`,
        headers: auth(alice),
        payload: { agentId: own.id, role: "sub" },
      });

      expect(res.statusCode).toBe(201);
      expect(res.json()).toEqual({
        id: expect.any(String),
        channelId: channelA.id,
        agentId: own.id,
        role: "sub",
        createdAt: expect.any(String),
        agent: { id: own.id, name: own.name, avatar: "a.png", avatarColor: "#111111", status: "draft" },
      });
    });

    it("the role defaults to primary", async () => {
      const { alice, channelA } = await setup();
      const own = await createAgent(prisma, { userId: alice.id });

      const res = await app.inject({
        method: "POST",
        url: `/channels/${channelA.id}/agents`,
        headers: auth(alice),
        payload: { agentId: own.id },
      });

      expect(res.statusCode).toBe(201);
      expect(res.json().role).toBe("primary");
    });

    it("another user's private agent that is active: 404 (it must be public too)", async () => {
      const { alice, bob, channelA } = await setup();
      const bobActive = await createAgent(prisma, { userId: bob.id, status: "active" });

      const res = await app.inject({
        method: "POST",
        url: `/channels/${channelA.id}/agents`,
        headers: auth(alice),
        payload: { agentId: bobActive.id },
      });

      expect(res.statusCode).toBe(404);
      expect(res.json().message).toBe("Agent not found");
    });

    it("another user's public agent that is not active: 404 (it must be active too)", async () => {
      const { alice, bob, channelA } = await setup();
      const bobPublicDraft = await createAgent(prisma, { userId: bob.id, isPublic: true });

      const res = await app.inject({
        method: "POST",
        url: `/channels/${channelA.id}/agents`,
        headers: auth(alice),
        payload: { agentId: bobPublicDraft.id },
      });

      expect(res.statusCode).toBe(404);
      expect(res.json().message).toBe("Agent not found");
    });
  });

  describe("DELETE /channels/:id/agents/:agentId", () => {
    it("the owner unlinks an agent: 204, its messages in this channel are deleted, others kept", async () => {
      const { alice, channelA, roomA, agentX } = await setup();
      const agentY = await createAgent(prisma, { userId: alice.id });
      await link(channelA.id, agentY.id);
      await message(roomA.id, agentY.id, "alice-y-1");
      const channelC = await createChannel(alice.id, "Alice second channel");
      await link(channelC.id, agentX.id);
      const roomC = await room(channelC.id);
      await message(roomC.id, agentX.id, "alice-c-x-1");

      const res = await app.inject({
        method: "DELETE",
        url: `/channels/${channelA.id}/agents/${agentX.id}`,
        headers: auth(alice),
      });

      expect(res.statusCode).toBe(204);
      expect(await contents()).toEqual(["alice-c-x-1", "alice-y-1"]);
      const links = await prisma.channelAgent.findMany({ where: { channelId: { in: [channelA.id, channelC.id] } } });
      expect(links.map((l) => `${l.channelId}:${l.agentId}`).sort()).toEqual(
        [`${channelA.id}:${agentY.id}`, `${channelC.id}:${agentX.id}`].sort(),
      );
    });

    it("an agent linked only to another channel of the owner: 404, that link and its messages kept", async () => {
      const { alice, channelA } = await setup();
      const agentZ = await createAgent(prisma, { userId: alice.id });
      const channelC = await createChannel(alice.id, "Alice second channel");
      await link(channelC.id, agentZ.id);
      const roomC = await room(channelC.id);
      await message(roomC.id, agentZ.id, "alice-c-z-1");

      const res = await app.inject({
        method: "DELETE",
        url: `/channels/${channelA.id}/agents/${agentZ.id}`,
        headers: auth(alice),
      });

      expect(res.statusCode).toBe(404);
      expect(res.json().message).toBe("Agent not linked to this channel");
      expect(await prisma.channelAgent.count({ where: { channelId: channelC.id, agentId: agentZ.id } })).toBe(1);
      expect(await contents()).toEqual(["alice-c-z-1", "alice-x-1"]);
    });

    it("an agent not linked to the channel while another one is: 404, the other link kept", async () => {
      const { alice, channelA, agentX } = await setup();
      const unlinked = await createAgent(prisma, { userId: alice.id });

      const res = await app.inject({
        method: "DELETE",
        url: `/channels/${channelA.id}/agents/${unlinked.id}`,
        headers: auth(alice),
      });

      expect(res.statusCode).toBe(404);
      expect(res.json().message).toBe("Agent not linked to this channel");
      const links = await prisma.channelAgent.findMany({ where: { channelId: channelA.id } });
      expect(links.map((l) => l.agentId)).toEqual([agentX.id]);
    });
  });

  describe("GET /channels/:id/agents/:agentId/messages", () => {
    const read = (user: { id: string; email: string }, channelId: string, agentId: string, query = "") =>
      app.inject({ method: "GET", url: `/channels/${channelId}/agents/${agentId}/messages${query}`, headers: auth(user) });

    it("only this agent's messages: another agent of the same room is left out", async () => {
      const { alice, channelA, roomA, agentX } = await setup();
      const agentY = await createAgent(prisma, { userId: alice.id });
      await link(channelA.id, agentY.id);
      await message(roomA.id, agentY.id, "alice-y-1");

      const res = await read(alice, channelA.id, agentX.id);

      expect(res.statusCode).toBe(200);
      expect(res.json().map((m: { content: string }) => m.content)).toEqual(["alice-x-1"]);
    });

    it("only this channel's room: the same agent's messages in another channel are left out", async () => {
      const alice = await createUser(prisma);
      const agentX = await createAgent(prisma, { userId: alice.id });
      // The other channel and its room are written first, so a lookup that ignored the channel finds them.
      const channelC = await createChannel(alice.id, "Alice second channel");
      await link(channelC.id, agentX.id);
      const roomC = await room(channelC.id);
      await message(roomC.id, agentX.id, "alice-c-x-1");
      const channelA = await createChannel(alice.id, "Alice channel");
      await link(channelA.id, agentX.id);
      const roomA = await room(channelA.id);
      await message(roomA.id, agentX.id, "alice-x-1");

      const res = await read(alice, channelA.id, agentX.id);

      expect(res.statusCode).toBe(200);
      expect(res.json().map((m: { content: string }) => m.content)).toEqual(["alice-x-1"]);
    });

    it("only the room named general: another room of the same channel is left out", async () => {
      const alice = await createUser(prisma);
      const agentX = await createAgent(prisma, { userId: alice.id });
      const channelA = await createChannel(alice.id, "Alice channel");
      await link(channelA.id, agentX.id);
      // The other room is written first, so a lookup that ignored the name finds it.
      const other = await room(channelA.id, "reminders");
      await message(other.id, agentX.id, "other-room-1");
      const general = await room(channelA.id);
      await message(general.id, agentX.id, "general-1");

      const res = await read(alice, channelA.id, agentX.id);

      expect(res.statusCode).toBe(200);
      expect(res.json().map((m: { content: string }) => m.content)).toEqual(["general-1"]);
    });

    it("oldest first, limit and offset, and a stored document is returned as `document`", async () => {
      const { alice, channelA, roomA, agentX } = await setup();
      const document = { format: "pdf", url: "https://files.invalid/a.pdf", filename: "a.pdf", expiresAt: "2026-12-01" };
      await prisma.channelMessage.create({
        data: { chatRoomId: roomA.id, agentId: agentX.id, role: "assistant", content: "alice-x-2", metadata: { document } },
      });
      await message(roomA.id, agentX.id, "alice-x-3");

      const all = await read(alice, channelA.id, agentX.id);
      const page = await read(alice, channelA.id, agentX.id, "?limit=1&offset=1");

      expect(all.statusCode).toBe(200);
      expect(all.json().map((m: { content: string }) => m.content)).toEqual(["alice-x-1", "alice-x-2", "alice-x-3"]);
      expect(all.json()[0].document).toBeUndefined();
      expect(all.json()[1]).toMatchObject({ role: "assistant", metadata: { document }, document });
      expect(page.json().map((m: { content: string }) => m.content)).toEqual(["alice-x-2"]);
    });

    it("the first read creates the channel's general room; the next read reuses it", async () => {
      const alice = await createUser(prisma);
      const agentX = await createAgent(prisma, { userId: alice.id });
      const channelA = await createChannel(alice.id, "Alice channel");
      await link(channelA.id, agentX.id);

      const first = await read(alice, channelA.id, agentX.id);
      const second = await read(alice, channelA.id, agentX.id);

      expect([first.statusCode, second.statusCode]).toEqual([200, 200]);
      expect(first.json()).toEqual([]);
      const rooms = await prisma.channelChatRoom.findMany();
      expect(rooms.map((r) => [r.channelId, r.name])).toEqual([[channelA.id, "general"]]);
    });

    it("an agent linked only to another channel of the owner: 404", async () => {
      const { alice, channelA } = await setup();
      const agentZ = await createAgent(prisma, { userId: alice.id });
      const channelC = await createChannel(alice.id, "Alice second channel");
      await link(channelC.id, agentZ.id);

      const res = await read(alice, channelA.id, agentZ.id);

      expect(res.statusCode).toBe(404);
      expect(res.json().message).toBe("Agent not in this channel");
    });

    it("an agent not linked to the channel while another one is: 404", async () => {
      const { alice, channelA } = await setup();
      const unlinked = await createAgent(prisma, { userId: alice.id });

      const res = await read(alice, channelA.id, unlinked.id);

      expect(res.statusCode).toBe(404);
      expect(res.json().message).toBe("Agent not in this channel");
    });
  });

  describe("DELETE /channels/:id/agents/:agentId/messages", () => {
    it("clears only this agent's messages of this channel: 204, another agent's and another channel's kept", async () => {
      const { alice, channelA, roomA, agentX } = await setup();
      const agentY = await createAgent(prisma, { userId: alice.id });
      await link(channelA.id, agentY.id);
      await message(roomA.id, agentY.id, "alice-y-1");
      const channelC = await createChannel(alice.id, "Alice second channel");
      await link(channelC.id, agentX.id);
      const roomC = await room(channelC.id);
      await message(roomC.id, agentX.id, "alice-c-x-1");

      const res = await app.inject({
        method: "DELETE",
        url: `/channels/${channelA.id}/agents/${agentX.id}/messages`,
        headers: auth(alice),
      });

      expect(res.statusCode).toBe(204);
      expect(await contents()).toEqual(["alice-c-x-1", "alice-y-1"]);
      expect(await prisma.channelAgent.count({ where: { channelId: channelA.id, agentId: agentX.id } })).toBe(1);
    });
  });

  describe("the owner's channel routes", () => {
    it("POST /channels: 201, the channel of the caller with an empty agent list", async () => {
      const alice = await createUser(prisma);

      const res = await app.inject({
        method: "POST",
        url: "/channels",
        headers: auth(alice),
        payload: { name: "New channel", icon: "i.png", color: "#123456" },
      });

      expect(res.statusCode).toBe(201);
      expect(res.json()).toMatchObject({ userId: alice.id, name: "New channel", icon: "i.png", color: "#123456", agents: [] });
      expect(await prisma.channel.count({ where: { userId: alice.id } })).toBe(1);
    });

    it("POST /channels with an invalid body: 400, nothing stored", async () => {
      const alice = await createUser(prisma);

      const res = await app.inject({ method: "POST", url: "/channels", headers: auth(alice), payload: { name: "" } });

      expect(res.statusCode).toBe(400);
      expect(await prisma.channel.count()).toBe(0);
    });

    // RX-184: the body schemas moved to channel/dto/channel.dto.ts; each route still refuses an invalid body.
    it("PATCH /channels/:id with an invalid body: 400, the channel unchanged", async () => {
      const { alice, channelA } = await setup();

      const res = await app.inject({
        method: "PATCH",
        url: `/channels/${channelA.id}`,
        headers: auth(alice),
        payload: { name: "" },
      });

      expect(res.statusCode).toBe(400);
      expect(await prisma.channel.count()).toBe(2);
      expect(await prisma.channel.findUnique({ where: { id: channelA.id } })).toMatchObject({ name: "Alice channel" });
    });

    it("POST /channels/:id/agents with an invalid body: 400, no link added", async () => {
      const { alice, channelA, agentX } = await setup();

      const res = await app.inject({
        method: "POST",
        url: `/channels/${channelA.id}/agents`,
        headers: auth(alice),
        payload: { agentId: "not-a-uuid" },
      });

      expect(res.statusCode).toBe(400);
      expect(await prisma.channelAgent.count()).toBe(2);
      const links = await prisma.channelAgent.findMany({ where: { channelId: channelA.id } });
      expect(links.map((l) => l.agentId)).toEqual([agentX.id]);
    });

    it("POST /channels/:id/agents/:agentId/chat with an invalid body: 400, no message stored", async () => {
      const { alice, channelA, agentX } = await setup();

      const res = await app.inject({
        method: "POST",
        url: `/channels/${channelA.id}/agents/${agentX.id}/chat`,
        headers: auth(alice),
        payload: { message: "" },
      });

      expect(res.statusCode).toBe(400);
      expect(await contents()).toEqual(["alice-x-1"]);
    });

    it("GET /channels: the caller's channels, newest first, with their agents and agent count", async () => {
      const { alice, channelA, agentX } = await setup();
      const newer = await prisma.channel.create({
        data: { userId: alice.id, name: "Newer", createdAt: new Date(Date.now() + 60_000) },
      });

      const res = await app.inject({ method: "GET", url: "/channels", headers: auth(alice) });

      expect(res.statusCode).toBe(200);
      expect(res.json().map((c: { id: string }) => c.id)).toEqual([newer.id, channelA.id]);
      expect(res.json()[1]).toMatchObject({
        _count: { agents: 1 },
        agents: [{ agentId: agentX.id, agent: { id: agentX.id, name: agentX.name, avatar: null, avatarColor: agentX.avatarColor, status: "draft" } }],
      });
      expect(Object.keys(res.json()[1].agents[0].agent).sort()).toEqual(["avatar", "avatarColor", "id", "name", "status"]);
    });

    it("GET /channels/:id: the channel with its agents, including model and description", async () => {
      const { alice, channelA, agentX } = await setup();

      const res = await app.inject({ method: "GET", url: `/channels/${channelA.id}`, headers: auth(alice) });

      expect(res.statusCode).toBe(200);
      expect(res.json().agents[0].agent).toEqual({
        id: agentX.id,
        name: agentX.name,
        avatar: null,
        avatarColor: agentX.avatarColor,
        status: "draft",
        model: "test-model",
        description: null,
      });
    });

    it("PATCH /channels/:id: the updated channel with its agents; the caller's other channel unchanged", async () => {
      const { alice, channelA, agentX } = await setup();
      const other = await createChannel(alice.id, "Alice other");

      const res = await app.inject({
        method: "PATCH",
        url: `/channels/${channelA.id}`,
        headers: auth(alice),
        payload: { color: "#abcdef" },
      });

      expect(res.statusCode).toBe(200);
      expect(res.json()).toMatchObject({ id: channelA.id, name: "Alice channel", color: "#abcdef", agents: [{ agentId: agentX.id }] });
      expect(await prisma.channel.findUnique({ where: { id: other.id } })).toMatchObject({ name: "Alice other", color: "#6366f1" });
    });
  });
});
