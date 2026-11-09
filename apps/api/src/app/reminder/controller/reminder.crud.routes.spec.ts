import { TestingModule } from "@nestjs/testing";
import { NestFastifyApplication } from "@nestjs/platform-fastify";
import { ReminderController } from "./reminder.controller";
import { ReminderService } from "../service/reminder.service";
import { AgentRunPolicyService } from "../../agent/service/agent-run-policy.service";
import { WorkspaceQuotaService } from "../../workspace/service/workspace-quota.service";
import { PrismaService } from "../../prisma/prisma.service";
import { createFastifyApp, createTestModule } from "../../../../test/test-module";
import { resetDatabase } from "../../../../test/test-database";
import { createAgent, createUser } from "../../../../test/factories";
import { asSessionUser } from "../../../../test/as-session-user";

// RNX-139: the reminder routes before the repository move: list, read, create, update, delete, the owner-only paths
// (another user's reminder answers as a missing one) and the soft delete (a deleted reminder is gone from every route).
// Real controller, ReminderService and run policy on the test database.
jest.mock("../../../lib/auth", () => ({ auth: { api: { getSession: async () => null } } }));

describe("RNX-139: reminder routes (Fastify, test database)", () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let app: NestFastifyApplication;

  beforeAll(async () => {
    ({ moduleRef, prisma } = await createTestModule({
      controllers: [ReminderController],
      providers: [ReminderService, AgentRunPolicyService, WorkspaceQuotaService],
    }));
    app = await createFastifyApp(moduleRef);
  });

  beforeEach(() => resetDatabase(prisma));

  afterAll(() => app?.close());

  /** A user with a channel, a linked agent and a room; `reminderCount` reminders are stored, oldest first. */
  const seedUser = async (reminderCount = 1) => {
    const user = await createUser(prisma);
    const agent = await createAgent(prisma, { userId: user.id });
    const channel = await prisma.channel.create({ data: { userId: user.id, name: "Team" } });
    await prisma.channelAgent.create({ data: { channelId: channel.id, agentId: agent.id } });
    const chatRoom = await prisma.channelChatRoom.create({ data: { channelId: channel.id, name: "general" } });
    const reminders = [];
    for (let i = 0; i < reminderCount; i++) {
      reminders.push(
        await prisma.reminder.create({
          data: {
            userId: user.id,
            agentId: agent.id,
            channelId: channel.id,
            chatRoomId: chatRoom.id,
            prompt: `Prompt ${i}`,
            cronExpression: "0 8 * * *",
            timezone: "UTC",
            nextRunAt: new Date(Date.now() + 60_000),
            createdAt: new Date(Date.now() - (reminderCount - i) * 1000),
          },
        }),
      );
    }
    return { user, agent, channel, chatRoom, reminders };
  };

  const payloadOf = (s: Awaited<ReturnType<typeof seedUser>>, extra: Record<string, unknown> = {}) => ({
    agentId: s.agent.id,
    channelId: s.channel.id,
    chatRoomId: s.chatRoom.id,
    prompt: "Weekly report",
    cronExpression: "0 9 * * 1",
    ...extra,
  });

  const unchanged = async (id: string, before: object) =>
    expect(await prisma.reminder.findUniqueOrThrow({ where: { id } })).toEqual(before);

  describe("GET /reminders", () => {
    it("lists the caller's reminders newest first, with the agent and channel, without deleted or other users' ones", async () => {
      const mine = await seedUser(3);
      const other = await seedUser(1);
      await prisma.reminder.update({ where: { id: mine.reminders[1].id }, data: { deletedAt: new Date() } });

      const res = await app.inject({ method: "GET", url: "/reminders", headers: asSessionUser(mine.user) });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.map((r: { id: string }) => r.id)).toEqual([mine.reminders[2].id, mine.reminders[0].id]);
      expect(body.map((r: { id: string }) => r.id)).not.toContain(other.reminders[0].id);
      expect(Object.keys(body[0].agent).sort()).toEqual(["avatar", "avatarColor", "id", "name"]);
      expect(body[0].channel).toEqual({ id: mine.channel.id, name: "Team" });
    });
  });

  describe("GET /reminders/:id", () => {
    it("returns the caller's reminder with its agent and channel", async () => {
      const s = await seedUser();

      const res = await app.inject({ method: "GET", url: `/reminders/${s.reminders[0].id}`, headers: asSessionUser(s.user) });

      expect(res.statusCode).toBe(200);
      expect(res.json()).toMatchObject({ id: s.reminders[0].id, prompt: "Prompt 0", agent: { id: s.agent.id }, channel: { id: s.channel.id } });
    });

    it("another user's reminder: 404", async () => {
      const s = await seedUser();
      const other = await createUser(prisma);

      const res = await app.inject({ method: "GET", url: `/reminders/${s.reminders[0].id}`, headers: asSessionUser(other) });

      expect(res.statusCode).toBe(404);
    });

    it("a deleted reminder: 404", async () => {
      const s = await seedUser();
      await prisma.reminder.update({ where: { id: s.reminders[0].id }, data: { deletedAt: new Date() } });

      const res = await app.inject({ method: "GET", url: `/reminders/${s.reminders[0].id}`, headers: asSessionUser(s.user) });

      expect(res.statusCode).toBe(404);
    });

    it("an id that is not a UUID: 400", async () => {
      const s = await seedUser();

      const res = await app.inject({ method: "GET", url: "/reminders/not-a-uuid", headers: asSessionUser(s.user) });

      expect(res.statusCode).toBe(400);
    });
  });

  describe("POST /reminders", () => {
    it("stores the reminder of the caller with the next fire time of its cron expression: 201", async () => {
      const s = await seedUser(0);

      const res = await app.inject({
        method: "POST",
        url: "/reminders",
        headers: asSessionUser(s.user),
        payload: payloadOf(s, { description: "Mondays", timezone: "UTC" }),
      });

      expect(res.statusCode).toBe(201);
      const stored = await prisma.reminder.findFirstOrThrow();
      expect(stored).toMatchObject({
        userId: s.user.id,
        agentId: s.agent.id,
        channelId: s.channel.id,
        chatRoomId: s.chatRoom.id,
        prompt: "Weekly report",
        description: "Mondays",
        cronExpression: "0 9 * * 1",
        timezone: "UTC",
        status: "ACTIVE",
        deletedAt: null,
      });
      expect(stored.nextRunAt.getTime()).toBeGreaterThan(Date.now());
      expect(stored.nextRunAt.getUTCDay()).toBe(1);
      expect(stored.nextRunAt.getUTCHours()).toBe(9);
      expect(res.json().id).toBe(stored.id);
    });

    it("an invalid cron expression: 400, nothing stored", async () => {
      const s = await seedUser(0);

      const res = await app.inject({
        method: "POST",
        url: "/reminders",
        headers: asSessionUser(s.user),
        payload: payloadOf(s, { cronExpression: "not a cron" }),
      });

      expect(res.statusCode).toBe(400);
      expect(await prisma.reminder.count()).toBe(0);
    });

    it("another user's channel: 404, nothing stored", async () => {
      const s = await seedUser(0);
      const other = await createUser(prisma);

      const res = await app.inject({ method: "POST", url: "/reminders", headers: asSessionUser(other), payload: payloadOf(s) });

      expect(res.statusCode).toBe(404);
      expect(await prisma.reminder.count()).toBe(0);
    });

    it("an agent that is not in the channel: 400, nothing stored", async () => {
      const s = await seedUser(0);
      const stranger = await createAgent(prisma, { userId: s.user.id });

      const res = await app.inject({
        method: "POST",
        url: "/reminders",
        headers: asSessionUser(s.user),
        payload: payloadOf(s, { agentId: stranger.id }),
      });

      expect(res.statusCode).toBe(400);
      expect(await prisma.reminder.count()).toBe(0);
    });

    it("a room of another channel: 404, nothing stored", async () => {
      const s = await seedUser(0);
      const otherChannel = await prisma.channel.create({ data: { userId: s.user.id, name: "Other" } });
      const otherRoom = await prisma.channelChatRoom.create({ data: { channelId: otherChannel.id, name: "elsewhere" } });

      const res = await app.inject({
        method: "POST",
        url: "/reminders",
        headers: asSessionUser(s.user),
        payload: payloadOf(s, { chatRoomId: otherRoom.id }),
      });

      expect(res.statusCode).toBe(404);
      expect(await prisma.reminder.count()).toBe(0);
    });
  });

  describe("PATCH /reminders/:id", () => {
    it("changes the prompt and description of the caller's reminder: 200", async () => {
      const s = await seedUser();

      const res = await app.inject({
        method: "PATCH",
        url: `/reminders/${s.reminders[0].id}`,
        headers: asSessionUser(s.user),
        payload: { prompt: "New prompt", description: "New description" },
      });

      expect(res.statusCode).toBe(200);
      expect(await prisma.reminder.findUniqueOrThrow({ where: { id: s.reminders[0].id } })).toMatchObject({
        prompt: "New prompt",
        description: "New description",
        cronExpression: "0 8 * * *",
      });
    });

    it("a new cron expression sets the next fire time again", async () => {
      const s = await seedUser();

      const res = await app.inject({
        method: "PATCH",
        url: `/reminders/${s.reminders[0].id}`,
        headers: asSessionUser(s.user),
        payload: { cronExpression: "30 14 * * *", timezone: "UTC" },
      });

      expect(res.statusCode).toBe(200);
      const stored = await prisma.reminder.findUniqueOrThrow({ where: { id: s.reminders[0].id } });
      expect([stored.cronExpression, stored.nextRunAt.getUTCHours(), stored.nextRunAt.getUTCMinutes()]).toEqual(["30 14 * * *", 14, 30]);
    });

    it("an invalid cron expression: 400, the reminder unchanged", async () => {
      const s = await seedUser();
      const before = await prisma.reminder.findUniqueOrThrow({ where: { id: s.reminders[0].id } });

      const res = await app.inject({
        method: "PATCH",
        url: `/reminders/${s.reminders[0].id}`,
        headers: asSessionUser(s.user),
        payload: { cronExpression: "not a cron" },
      });

      expect(res.statusCode).toBe(400);
      await unchanged(s.reminders[0].id, before);
    });

    it("resuming (ACTIVE) clears the failure count and the last error; PAUSED pauses", async () => {
      const s = await seedUser();
      const id = s.reminders[0].id;
      await prisma.reminder.update({ where: { id }, data: { status: "FAILED", consecutiveFailures: 3, lastError: "boom" } });

      const resumed = await app.inject({ method: "PATCH", url: `/reminders/${id}`, headers: asSessionUser(s.user), payload: { status: "ACTIVE" } });

      expect(resumed.statusCode).toBe(200);
      expect(await prisma.reminder.findUniqueOrThrow({ where: { id } })).toMatchObject({ status: "ACTIVE", consecutiveFailures: 0, lastError: null });
      const paused = await app.inject({ method: "PATCH", url: `/reminders/${id}`, headers: asSessionUser(s.user), payload: { status: "PAUSED" } });
      expect(paused.statusCode).toBe(200);
      expect((await prisma.reminder.findUniqueOrThrow({ where: { id } })).status).toBe("PAUSED");
    });

    it("another user's reminder: 404, unchanged", async () => {
      const s = await seedUser();
      const other = await createUser(prisma);
      const before = await prisma.reminder.findUniqueOrThrow({ where: { id: s.reminders[0].id } });

      const res = await app.inject({
        method: "PATCH",
        url: `/reminders/${s.reminders[0].id}`,
        headers: asSessionUser(other),
        payload: { prompt: "Hijacked" },
      });

      expect(res.statusCode).toBe(404);
      await unchanged(s.reminders[0].id, before);
    });

    it("a deleted reminder: 404, unchanged", async () => {
      const s = await seedUser();
      await prisma.reminder.update({ where: { id: s.reminders[0].id }, data: { deletedAt: new Date() } });
      const before = await prisma.reminder.findUniqueOrThrow({ where: { id: s.reminders[0].id } });

      const res = await app.inject({
        method: "PATCH",
        url: `/reminders/${s.reminders[0].id}`,
        headers: asSessionUser(s.user),
        payload: { prompt: "Back from the dead" },
      });

      expect(res.statusCode).toBe(404);
      await unchanged(s.reminders[0].id, before);
    });
  });

  describe("DELETE /reminders/:id", () => {
    it("soft deletes the caller's reminder (deletedAt set, paused): 204, then it is gone from the list and the read", async () => {
      const s = await seedUser();
      const id = s.reminders[0].id;

      const res = await app.inject({ method: "DELETE", url: `/reminders/${id}`, headers: asSessionUser(s.user) });

      expect(res.statusCode).toBe(204);
      const stored = await prisma.reminder.findUniqueOrThrow({ where: { id } });
      expect(stored.deletedAt).not.toBeNull();
      expect(stored.status).toBe("PAUSED");
      const list = await app.inject({ method: "GET", url: "/reminders", headers: asSessionUser(s.user) });
      expect(list.json()).toEqual([]);
      const read = await app.inject({ method: "GET", url: `/reminders/${id}`, headers: asSessionUser(s.user) });
      expect(read.statusCode).toBe(404);
    });

    it("another user's reminder: 404, unchanged", async () => {
      const s = await seedUser();
      const other = await createUser(prisma);
      const before = await prisma.reminder.findUniqueOrThrow({ where: { id: s.reminders[0].id } });

      const res = await app.inject({ method: "DELETE", url: `/reminders/${s.reminders[0].id}`, headers: asSessionUser(other) });

      expect(res.statusCode).toBe(404);
      await unchanged(s.reminders[0].id, before);
    });

    it("a reminder already deleted: 404", async () => {
      const s = await seedUser();
      await prisma.reminder.update({ where: { id: s.reminders[0].id }, data: { deletedAt: new Date() } });

      const res = await app.inject({ method: "DELETE", url: `/reminders/${s.reminders[0].id}`, headers: asSessionUser(s.user) });

      expect(res.statusCode).toBe(404);
    });
  });

  describe("RNX-124: reminders of a deleted agent (D99)", () => {
    /** The user's agent A with two reminders, and a second live agent B in the same channel with one reminder. */
    const seedTwoAgents = async () => {
      const s = await seedUser(2);
      const b = await createAgent(prisma, { userId: s.user.id });
      await prisma.channelAgent.create({ data: { channelId: s.channel.id, agentId: b.id } });
      const ofB = await prisma.reminder.create({
        data: {
          userId: s.user.id,
          agentId: b.id,
          channelId: s.channel.id,
          chatRoomId: s.chatRoom.id,
          prompt: "Of B",
          cronExpression: "0 8 * * *",
          timezone: "UTC",
          nextRunAt: new Date(Date.now() + 60_000),
        },
      });
      return { ...s, b, ofB };
    };
    const markAgentDeleted = (agentId: string, userId: string) =>
      prisma.agent.updateMany({ where: { id: agentId }, data: { deletedAt: new Date(), deletedById: userId } });
    const clearAgentDeleted = (agentId: string) =>
      prisma.agent.updateMany({ where: { id: agentId }, data: { deletedAt: null, deletedById: null } });

    it("RNX-124 D99: the list leaves out the deleted agent's reminders and nothing else changes; listed again once the agent is live", async () => {
      const s = await seedTwoAgents();
      const list = async () => (await app.inject({ method: "GET", url: "/reminders", headers: asSessionUser(s.user) })).json();
      const before = await list();

      await markAgentDeleted(s.agent.id, s.user.id);
      const hidden = await list();
      await clearAgentDeleted(s.agent.id);
      const shown = await list();

      expect(before.map((r: { id: string }) => r.id).sort()).toEqual([s.ofB.id, ...s.reminders.map((r) => r.id)].sort());
      expect(hidden).toEqual(before.filter((r: { id: string }) => r.id === s.ofB.id));
      expect(shown).toEqual(before);
    });

    it.each([
      ["read it", "GET", undefined],
      ["update it", "PATCH", { prompt: "Changed" }],
      ["delete it", "DELETE", undefined],
    ] as const)("RNX-124 D99: %s → 404, the reminder row unchanged; readable again once the agent is live", async (_label, method, payload) => {
      const s = await seedTwoAgents();
      const id = s.reminders[0].id;
      const before = await prisma.reminder.findUniqueOrThrow({ where: { id } });
      await markAgentDeleted(s.agent.id, s.user.id);

      const res = await app.inject({ method, url: `/reminders/${id}`, headers: asSessionUser(s.user), payload });

      expect(res.statusCode).toBe(404);
      await unchanged(id, before);
      await clearAgentDeleted(s.agent.id);
      const read = await app.inject({ method: "GET", url: `/reminders/${id}`, headers: asSessionUser(s.user) });
      expect([read.statusCode, read.json().id]).toEqual([200, id]);
    });

    it("RNX-124: deleting a reminder sets deletedById to the caller", async () => {
      const s = await seedUser();
      const id = s.reminders[0].id;

      const res = await app.inject({ method: "DELETE", url: `/reminders/${id}`, headers: asSessionUser(s.user) });

      expect(res.statusCode).toBeLessThan(300);
      const stored = await prisma.reminder.findUniqueOrThrow({ where: { id } });
      expect([stored.deletedAt, stored.deletedById]).toEqual([expect.any(Date), s.user.id]);
    });
  });

  describe("RNX-145: reminders of a deleted channel (D99)", () => {
    /** The user's channel X with two reminders, and a second live channel Y of the same agent with one reminder. */
    const seedTwoChannels = async () => {
      const s = await seedUser(2);
      const y = await prisma.channel.create({ data: { userId: s.user.id, name: "Other" } });
      await prisma.channelAgent.create({ data: { channelId: y.id, agentId: s.agent.id } });
      const roomY = await prisma.channelChatRoom.create({ data: { channelId: y.id, name: "general" } });
      const ofY = await prisma.reminder.create({
        data: {
          userId: s.user.id,
          agentId: s.agent.id,
          channelId: y.id,
          chatRoomId: roomY.id,
          prompt: "Of Y",
          cronExpression: "0 8 * * *",
          timezone: "UTC",
          nextRunAt: new Date(Date.now() + 60_000),
        },
      });
      return { ...s, ofY };
    };
    const markChannelDeleted = (channelId: string, userId: string) =>
      prisma.channel.updateMany({ where: { id: channelId }, data: { deletedAt: new Date(), deletedById: userId } });
    const clearChannelDeleted = (channelId: string) =>
      prisma.channel.updateMany({ where: { id: channelId }, data: { deletedAt: null, deletedById: null } });

    it("RNX-145 AC12: the list leaves out the deleted channel's reminders and nothing else changes; listed again once the channel is live", async () => {
      const s = await seedTwoChannels();
      const list = async () => (await app.inject({ method: "GET", url: "/reminders", headers: asSessionUser(s.user) })).json();
      const before = await list();

      await markChannelDeleted(s.channel.id, s.user.id);
      const hidden = await list();
      await clearChannelDeleted(s.channel.id);
      const shown = await list();

      expect(before.map((r: { id: string }) => r.id).sort()).toEqual([s.ofY.id, ...s.reminders.map((r) => r.id)].sort());
      expect(hidden).toEqual(before.filter((r: { id: string }) => r.id === s.ofY.id));
      expect(shown).toEqual(before);
    });

    it.each([
      ["read it", "GET", undefined],
      ["update it", "PATCH", { prompt: "Changed" }],
      ["delete it", "DELETE", undefined],
    ] as const)("RNX-145 AC12: %s → 404, the reminder row unchanged; readable again once the channel is live", async (_label, method, payload) => {
      const s = await seedTwoChannels();
      const id = s.reminders[0].id;
      const before = await prisma.reminder.findUniqueOrThrow({ where: { id } });
      await markChannelDeleted(s.channel.id, s.user.id);

      const res = await app.inject({ method, url: `/reminders/${id}`, headers: asSessionUser(s.user), payload });

      expect(res.statusCode).toBe(404);
      await unchanged(id, before);
      await clearChannelDeleted(s.channel.id);
      const read = await app.inject({ method: "GET", url: `/reminders/${id}`, headers: asSessionUser(s.user) });
      expect([read.statusCode, read.json().id]).toEqual([200, id]);
    });

    it("RNX-145 AC4: a new reminder in the deleted channel → 404, nothing stored", async () => {
      const s = await seedTwoChannels();
      await markChannelDeleted(s.channel.id, s.user.id);
      const count = await prisma.reminder.count();

      const res = await app.inject({ method: "POST", url: "/reminders", headers: asSessionUser(s.user), payload: payloadOf(s) });

      expect(res.statusCode).toBe(404);
      expect(await prisma.reminder.count()).toBe(count);
    });
  });
});
