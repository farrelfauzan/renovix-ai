import { TestingModule } from "@nestjs/testing";
import { NestFastifyApplication } from "@nestjs/platform-fastify";
import { ChannelController } from "./channel.controller";
import { ChannelService } from "../service/channel.service";
import { ChannelRepository } from "../repository/channel.repository";
import { ChannelChatService } from "../service/channel-chat.service";
import { S3Service } from "../../knowledge/service/s3.service";
import { DocumentService } from "../../document/service/document.service";
import { AgentToolService } from "../../agent/service/agent-tool.service";
import { AgentMemoryService } from "../../agent/service/agent-memory.service";
import { AgentRunMeterService } from "../../agent/service/agent-run-meter.service";
import { UsageService } from "../../usage/service/usage.service";
import { GuardrailService } from "../../guardrail/service/guardrail.service";
import { ModelRegistryService } from "../../config/model-registry.service";
import { CreditService } from "../../billing/service/credit.service";
import { PlatformSettingsService } from "../../offers/service/platform-settings.service";
import { ProvidersModule } from "../../providers/providers.module";
import { PrismaService } from "../../prisma/prisma.service";
import { createFastifyApp, createTestModule } from "../../../../test/test-module";
import { resetDatabase } from "../../../../test/test-database";
import { createAgent, createPackageSnapshot, createUser, createWorkspace } from "../../../../test/factories";
import { FakeProviderAdapter, withFakeProvider } from "../../../../test/fake-provider";
import { createResolvableModel } from "../../../../test/provider-model";
import { fundPaidWallet } from "../../../../test/credit-funding";
import { assertCreditLedgerInvariants } from "../../../../test/credit-ledger-invariants";
import { requestOverSocket } from "../../../../test/sse-client";
import { AgentLinkService } from "../../agent/service/agent-link.service";
import { WorkspaceQuotaService } from "../../workspace/service/workspace-quota.service";
import { AgentRunPolicyService } from "../../agent/service/agent-run-policy.service";
import { asSessionUser } from "../../../../test/as-session-user";

// RNX-124: a deleted agent in a channel. The room chat route (POST /channels/:id/agents/:agentId/chat) does not run it
// (404 before the SSE headers, no model call, message, reservation or ledger entry); its room message routes and the
// unlink route answer 404. D99: its channel link (ChannelAgent, a required relation to the agent) is left out of the
// channel list, the channel read and the channel update answer, and out of the agent count, with nothing else in them
// changed; the link row itself stays and is shown again once the test clears the agent's deletedAt. Its channel
// messages (ChannelMessage.agentId) stay. The agent is marked deleted straight in the database here
// (agent.soft-delete.spec.ts covers DELETE /agents/:id). Real controller and services, test database, fake provider.
// RNX-145: DELETE /channels/:id soft-deletes the channel (deletedAt, deletedById, 204 with no body as before); its
// agent links, rooms, messages and reminders stay. Every channel route then answers 404 and changes nothing, it is not
// listed, its room chat is refused before the SSE headers; all of it is back once the marker is cleared. `all` is a
// client with nothing on PrismaService's default filter map, to read the rows as they are. RNX-145 AC13: the channel of
// a deleted workspace is not listed and refuses every room chat; back once the workspace marker is cleared.
jest.mock("../../knowledge/service/s3.service", () => ({ S3Service: class {} }));
jest.mock("../../document/service/document.service", () => ({ DocumentService: class {} }));
jest.mock("../../agent/service/agent-tool.service", () => ({ AgentToolService: class {} }));
jest.mock("../../guardrail/service/guardrail.service", () => ({ GuardrailService: class {} }));

describe("RNX-124: a deleted agent in a channel (Fastify, test database, fake provider)", () => {
  const fake = new FakeProviderAdapter();
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let app: NestFastifyApplication;
  let all: PrismaService;

  beforeAll(async () => {
    ({ moduleRef, prisma } = await createTestModule(
      {
        imports: [ProvidersModule],
        controllers: [ChannelController],
        providers: [
          ChannelService,
          AgentRunPolicyService,
          ChannelChatService,
          AgentLinkService,
          WorkspaceQuotaService,
          AgentRunMeterService,
          CreditService,
          PlatformSettingsService,
          ModelRegistryService,
          UsageService,
          {
            provide: AgentToolService,
            useValue: {
              buildToolSchemasWithMcp: async () => [],
              cleanupMcpConnections: async () => undefined,
            },
          },
          { provide: AgentMemoryService, useValue: { getWorkspaceMemoryContext: async () => "", extractAndStore: async () => undefined } },
          {
            provide: GuardrailService,
            useValue: {
              checkInput: async () => ({ blocked: false }),
              checkOutput: async (content: string) => ({ blocked: false, content }),
            },
          },
          { provide: S3Service, useValue: {} },
          { provide: DocumentService, useValue: {} },
        ],
      },
      (b) => withFakeProvider(b, fake),
    ));
    app = await createFastifyApp(moduleRef);
    all = PrismaService.create({});
  });

  beforeEach(async () => {
    await resetDatabase(prisma);
    fake.requests.length = 0;
    await createResolvableModel(prisma, { slug: "test-model", modelName: "test-model", maxTokens: 8192 });
    // Standard 1 / 1 / 1: a call costs its token count in micro-credits; the first call's max_tokens alone is 0.004096.
    await prisma.tierRate.create({
      data: { tier: "standard", inputCreditsPerToken: 1, cachedCreditsPerToken: 1, outputCreditsPerToken: 1 },
    });
    await moduleRef.get(ModelRegistryService).refresh();
  });

  afterEach(() => jest.restoreAllMocks());

  afterAll(async () => {
    await app?.close();
    await all?.$disconnect();
  });

  /** A funded user's channel with agent A and agent B, a session cookie, and one stored room message of A. */
  const seed = async () => {
    const user = await createUser(prisma);
    await createPackageSnapshot(prisma, { userId: user.id });
    await fundPaidWallet(prisma, user.id, "1");
    const a = await createAgent(prisma, { userId: user.id, name: "Agent A" });
    const b = await createAgent(prisma, { userId: user.id, name: "Agent B" });
    const channel = await prisma.channel.create({ data: { userId: user.id, name: "Room" } });
    const linkA = await prisma.channelAgent.create({ data: { channelId: channel.id, agentId: a.id } });
    await prisma.channelAgent.create({ data: { channelId: channel.id, agentId: b.id } });
    const room = await prisma.channelChatRoom.create({ data: { channelId: channel.id, name: "general" } });
    await prisma.channelMessage.create({ data: { chatRoomId: room.id, agentId: a.id, role: "user", content: "Earlier" } });
    return { user, a, b, channel, linkA, session: asSessionUser(user) };
  };

  const markDeleted = (agentId: string, userId: string) =>
    prisma.agent.updateMany({ where: { id: agentId }, data: { deletedAt: new Date(), deletedById: userId } });
  const clearDeleted = (agentId: string) =>
    prisma.agent.updateMany({ where: { id: agentId }, data: { deletedAt: null, deletedById: null } });

  const postChat = (channelId: string, agentId: string, session: { cookie: string }) =>
    requestOverSocket(app, {
      method: "POST",
      path: `/channels/${channelId}/agents/${agentId}/chat`,
      headers: session,
      body: { message: "Hi" },
    });

  /** Rows a message writes, and the ledger. */
  const writtenRows = async () => ({
    messages: await prisma.channelMessage.count(),
    reservations: await prisma.creditReservation.count(),
    ledgerEntries: await prisma.creditLedgerEntry.count(),
  });

  /** The ids of the agents a channel answer carries, and its agent count when it has one. */
  const agentIdsOf = (channel: { agents: Array<{ agentId: string }> }) => channel.agents.map((link) => link.agentId).sort();

  it("RNX-124 AC3: room chat with a deleted agent → HTTP 404 before the SSE headers; no model call, message, reservation or ledger entry", async () => {
    const { user, a, channel, session } = await seed();
    await markDeleted(a.id, user.id);
    const before = await writtenRows();

    const res = await postChat(channel.id, a.id, session);

    expect([res.statusCode, res.contentType]).toEqual([404, expect.stringContaining("application/json")]);
    expect(fake.requests).toHaveLength(0);
    expect(await writtenRows()).toEqual(before);
    await assertCreditLedgerInvariants(prisma);
  });

  it("RNX-124 AC3 (control): with the agent's deletedAt cleared, the same room chat runs → 200 SSE with the reply", async () => {
    const { user, a, channel, session } = await seed();
    await markDeleted(a.id, user.id);
    await clearDeleted(a.id);
    fake.enqueue({ content: "none" }, { content: "Hello there", usage: { prompt_tokens: 10, completion_tokens: 5 } });

    const res = await postChat(channel.id, a.id, session);

    expect([res.statusCode, res.contentType]).toEqual([200, "text/event-stream"]);
    expect(res.body).toContain("Hello there");
  });

  it.each([
    ["read its room messages", "GET", "messages"],
    ["clear its room messages", "DELETE", "messages"],
    ["unlink it from the channel", "DELETE", ""],
  ] as const)("RNX-124 AC4: %s → 404; its messages and its link stay", async (_label, method, suffix) => {
    const { user, a, channel, linkA, session } = await seed();
    await markDeleted(a.id, user.id);

    const res = await app.inject({
      method,
      url: `/channels/${channel.id}/agents/${a.id}${suffix ? `/${suffix}` : ""}`,
      headers: session,
    });

    expect(res.statusCode).toBe(404);
    expect(await prisma.channelMessage.count({ where: { agentId: a.id } })).toBe(1);
    expect(await prisma.channelAgent.findUnique({ where: { id: linkA.id } })).toEqual(linkA);
  });

  it("RNX-124 AC4 (control): with the agent live, reading its room messages answers 200", async () => {
    const { a, channel, session } = await seed();

    const res = await app.inject({ method: "GET", url: `/channels/${channel.id}/agents/${a.id}/messages`, headers: session });

    expect(res.statusCode).toBe(200);
    expect(res.json().map((m: { content: string }) => m.content)).toEqual(["Earlier"]);
  });

  describe("RNX-124 AC5, D99: the channel's link to a deleted agent is left out whole, and shown again once it is live", () => {
    it("the channel list: A's link and count are left out, B's entry is unchanged; the link row stays", async () => {
      const { user, a, b, channel, linkA, session } = await seed();
      // The links come in no set order: sorted by agent id to compare
      const list = async () =>
        (await app.inject({ method: "GET", url: "/channels", headers: session }))
          .json()
          .map((c: { agents: Array<{ agentId: string }> }) => ({
            ...c,
            agents: [...c.agents].sort((x, y) => x.agentId.localeCompare(y.agentId)),
          }));
      const before = await list();

      await markDeleted(a.id, user.id);
      const hidden = await list();
      await clearDeleted(a.id);
      const shown = await list();

      expect([agentIdsOf(before[0]), before[0]._count.agents]).toEqual([[a.id, b.id].sort(), 2]);
      expect([agentIdsOf(hidden[0]), hidden[0]._count.agents]).toEqual([[b.id], 1]);
      expect(hidden[0].agents[0]).toEqual(before[0].agents.find((link: { agentId: string }) => link.agentId === b.id));
      expect({ ...hidden[0], agents: undefined, _count: undefined }).toEqual({ ...before[0], agents: undefined, _count: undefined });
      expect(await prisma.channelAgent.findUnique({ where: { id: linkA.id } })).toEqual(linkA);
      expect(shown).toEqual(before);
      expect(channel.id).toBe(before[0].id);
    });

    it("the channel read and the channel update answer leave A out; both show it again once it is live", async () => {
      const { user, a, b, channel, session } = await seed();
      const read = async () => (await app.inject({ method: "GET", url: `/channels/${channel.id}`, headers: session })).json();
      const update = async () =>
        (await app.inject({ method: "PATCH", url: `/channels/${channel.id}`, headers: session, payload: { name: "Room" } })).json();

      await markDeleted(a.id, user.id);
      const hidden = [await read(), await update()];
      await clearDeleted(a.id);
      const shown = [await read(), await update()];

      expect(hidden.map(agentIdsOf)).toEqual([[b.id], [b.id]]);
      expect(shown.map(agentIdsOf)).toEqual([[a.id, b.id].sort(), [a.id, b.id].sort()]);
    });
  });

  describe("RNX-145: a deleted channel", () => {
    /** Every row a channel route could change, read as they are (deleted ones included). */
    const readRows = async () => ({
      channels: await all.channel.findMany({ orderBy: { id: "asc" } }),
      links: await all.channelAgent.findMany({ orderBy: { id: "asc" } }),
      rooms: await all.channelChatRoom.findMany({ orderBy: { id: "asc" } }),
      messages: await all.channelMessage.findMany({ orderBy: { id: "asc" } }),
      reminders: await all.reminder.findMany({ orderBy: { id: "asc" } }),
      reservations: await all.creditReservation.count(),
      ledgerEntries: await all.creditLedgerEntry.count(),
    });
    /** The seed plus a reminder in the channel's room. */
    const seedWithReminder = async () => {
      const s = await seed();
      const room = await prisma.channelChatRoom.findFirstOrThrow({ where: { channelId: s.channel.id } });
      await prisma.reminder.create({
        data: { userId: s.user.id, agentId: s.a.id, channelId: s.channel.id, chatRoomId: room.id, prompt: "Ping", cronExpression: "0 8 * * *", nextRunAt: new Date() },
      });
      return s;
    };
    const deleteChannel = (channelId: string, session: { cookie: string }) =>
      app.inject({ method: "DELETE", url: `/channels/${channelId}`, headers: session });
    const clearChannelMarker = (channelId: string) =>
      all.channel.updateMany({ where: { id: channelId }, data: { deletedAt: null, deletedById: null } });

    it("RNX-145 AC1: DELETE answers 204 with no body as before; the row gets deletedAt and deletedById, its links, rooms, messages and reminders stay", async () => {
      const { user, channel, session } = await seedWithReminder();
      const before = await readRows();

      const res = await deleteChannel(channel.id, session);

      expect([res.statusCode, res.body]).toEqual([204, ""]);
      const after = await readRows();
      expect(after.channels).toEqual([
        { ...before.channels[0], deletedAt: expect.any(Date), deletedById: user.id, updatedAt: expect.any(Date) },
      ]);
      expect({ ...after, channels: [] }).toEqual({ ...before, channels: [] });
    });

    it("RNX-145 AC2: after the delete it is not listed; read, update and delete again answer 404 and change nothing; back once the marker is cleared", async () => {
      const { channel, session } = await seedWithReminder();
      await deleteChannel(channel.id, session);
      const before = await readRows();

      const list = await app.inject({ method: "GET", url: "/channels", headers: session });
      const read = await app.inject({ method: "GET", url: `/channels/${channel.id}`, headers: session });
      const update = await app.inject({ method: "PATCH", url: `/channels/${channel.id}`, headers: session, payload: { name: "Renamed" } });
      const again = await deleteChannel(channel.id, session);

      expect(list.json()).toEqual([]);
      expect([read.statusCode, update.statusCode, again.statusCode]).toEqual([404, 404, 404]);
      expect(await readRows()).toEqual(before);
      await clearChannelMarker(channel.id);
      const listBack = await app.inject({ method: "GET", url: "/channels", headers: session });
      const readBack = await app.inject({ method: "GET", url: `/channels/${channel.id}`, headers: session });
      expect(listBack.json().map((c: { id: string }) => c.id)).toEqual([channel.id]);
      expect(readBack.statusCode).toBe(200);
    });

    it.each([
      ["read its room messages", "GET", "messages"],
      ["clear its room messages", "DELETE", "messages"],
      ["unlink an agent", "DELETE", ""],
    ] as const)("RNX-145 AC4: %s → 404; nothing changes", async (_label, method, suffix) => {
      const { a, channel, session } = await seedWithReminder();
      await deleteChannel(channel.id, session);
      const before = await readRows();

      const res = await app.inject({
        method,
        url: `/channels/${channel.id}/agents/${a.id}${suffix ? `/${suffix}` : ""}`,
        headers: session,
      });

      expect(res.statusCode).toBe(404);
      expect(res.body).not.toContain("Earlier");
      expect(await readRows()).toEqual(before);
    });

    it("RNX-145 AC4: adding an agent to it → 404, no link added", async () => {
      const { user, channel, session } = await seedWithReminder();
      const c = await createAgent(prisma, { userId: user.id, name: "Agent C" });
      await deleteChannel(channel.id, session);
      const before = await readRows();

      const res = await app.inject({ method: "POST", url: `/channels/${channel.id}/agents`, headers: session, payload: { agentId: c.id } });

      expect(res.statusCode).toBe(404);
      expect(await readRows()).toEqual(before);
    });

    it("RNX-145 AC4: a room chat message → HTTP 404 before the SSE headers; no model call, message, reservation or ledger entry. Control: with the marker cleared it runs (200 SSE)", async () => {
      const { a, channel, session } = await seedWithReminder();
      await deleteChannel(channel.id, session);
      const before = await readRows();

      const res = await postChat(channel.id, a.id, session);

      expect([res.statusCode, res.contentType]).toEqual([404, expect.stringContaining("application/json")]);
      expect(fake.requests).toHaveLength(0);
      expect(await readRows()).toEqual(before);
      await assertCreditLedgerInvariants(prisma);
      await clearChannelMarker(channel.id);
      fake.enqueue({ content: "none" }, { content: "Hello there", usage: { prompt_tokens: 10, completion_tokens: 5 } });
      const back = await postChat(channel.id, a.id, session);
      expect([back.statusCode, back.contentType]).toEqual([200, "text/event-stream"]);
    });

    it("RNX-145 AC8: another user's DELETE answers 404 and marks nothing", async () => {
      const { channel } = await seedWithReminder();
      const mallory = await createUser(prisma);
      const before = await readRows();

      const res = await deleteChannel(channel.id, asSessionUser(mallory));

      expect(res.statusCode).toBe(404);
      expect(await readRows()).toEqual(before);
    });

    it("RNX-145: the writes by id name deletedAt: null: a second soft delete and an update of a deleted channel answer 404 and change nothing", async () => {
      const { user, channel } = await seedWithReminder();
      const channels = moduleRef.get(ChannelRepository);
      await channels.softDeleteChannel(channel.id, user.id);
      const before = await readRows();

      await expect(channels.softDeleteChannel(channel.id, "someone-else")).rejects.toMatchObject({ status: 404 });
      await expect(channels.updateChannel(channel.id, { name: "Renamed" })).rejects.toMatchObject({ status: 404 });

      expect(await readRows()).toEqual(before);
    });

    describe("RNX-145 AC13: the channel of a deleted workspace (RNX-125)", () => {
      /** The seeded channel becomes a workspace's channel; agents A and B stay in the user's live default workspace. */
      const seedWorkspaceChannel = async () => {
        const s = await seedWithReminder();
        const plain = await prisma.channel.create({ data: { userId: s.user.id, name: "Plain" } });
        const workspace = await createWorkspace(prisma, { ownerId: s.user.id, channelId: s.channel.id });
        return { ...s, plain, workspace };
      };
      const markWorkspace = (workspaceId: string, userId: string) =>
        all.workspace.updateMany({ where: { id: workspaceId }, data: { deletedAt: new Date(), deletedById: userId } });
      const clearWorkspace = (workspaceId: string) =>
        all.workspace.updateMany({ where: { id: workspaceId }, data: { deletedAt: null, deletedById: null } });
      const listIds = async (session: { cookie: string }) =>
        (await app.inject({ method: "GET", url: "/channels", headers: session })).json().map((c: { id: string }) => c.id).sort();

      it("RNX-145 AC13: GET /channels leaves it out and still lists the channel without a workspace; listed again once the workspace marker is cleared", async () => {
        const { user, channel, plain, workspace, session } = await seedWorkspaceChannel();
        await markWorkspace(workspace.id, user.id);

        const hidden = await listIds(session);
        await clearWorkspace(workspace.id);
        const shown = await listIds(session);

        expect(hidden).toEqual([plain.id]);
        expect(shown).toEqual([channel.id, plain.id].sort());
      });

      it("RNX-145 AC13: a room chat with an agent of the user's live default workspace → HTTP 404 before the SSE headers; no model call, message, reservation or ledger entry. Control: with the workspace marker cleared it runs (200 SSE)", async () => {
        const { user, a, channel, workspace, session } = await seedWorkspaceChannel();
        await markWorkspace(workspace.id, user.id);
        const before = await readRows();

        const res = await postChat(channel.id, a.id, session);

        expect([res.statusCode, res.contentType]).toEqual([404, expect.stringContaining("application/json")]);
        expect(fake.requests).toHaveLength(0);
        expect(await readRows()).toEqual(before);
        await assertCreditLedgerInvariants(prisma);
        await clearWorkspace(workspace.id);
        fake.enqueue({ content: "none" }, { content: "Hello there", usage: { prompt_tokens: 10, completion_tokens: 5 } });
        const back = await postChat(channel.id, a.id, session);
        expect([back.statusCode, back.contentType]).toEqual([200, "text/event-stream"]);
      });
    });

    it("RNX-145 (RX-144, RNX-202): the soft delete itself refuses a channel that has a workspace (the read-then-delete race): 404, no marker; the channel without one is deleted (control)", async () => {
      const { user, channel } = await seedWithReminder();
      const plain = await prisma.channel.create({ data: { userId: user.id, name: "Plain" } });
      await createWorkspace(prisma, { ownerId: user.id, channelId: channel.id });
      const channels = moduleRef.get(ChannelRepository);

      await expect(channels.softDeleteChannel(channel.id, user.id)).rejects.toMatchObject({ status: 404 });
      await channels.softDeleteChannel(plain.id, user.id);

      expect(await all.channel.findUnique({ where: { id: channel.id } })).toMatchObject({ deletedAt: null, deletedById: null });
      expect(await all.channel.findUnique({ where: { id: plain.id } })).toMatchObject({ deletedById: user.id });
    });
  });
});
