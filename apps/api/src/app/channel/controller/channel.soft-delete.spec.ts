import { TestingModule } from "@nestjs/testing";
import { NestFastifyApplication } from "@nestjs/platform-fastify";
import { ChannelController } from "./channel.controller";
import { ChannelService } from "../service/channel.service";
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
import { createAgent, createPackageSnapshot, createUser } from "../../../../test/factories";
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
jest.mock("../../knowledge/service/s3.service", () => ({ S3Service: class {} }));
jest.mock("../../document/service/document.service", () => ({ DocumentService: class {} }));
jest.mock("../../agent/service/agent-tool.service", () => ({ AgentToolService: class {} }));
jest.mock("../../guardrail/service/guardrail.service", () => ({ GuardrailService: class {} }));

describe("RNX-124: a deleted agent in a channel (Fastify, test database, fake provider)", () => {
  const fake = new FakeProviderAdapter();
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let app: NestFastifyApplication;

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
});
