import { TestingModule } from "@nestjs/testing";
import { NestFastifyApplication } from "@nestjs/platform-fastify";
import { ChannelController } from "./channel.controller";
import { ChannelService } from "../service/channel.service";
import { ChannelChatService } from "../service/channel-chat.service";
import { S3Service } from "../../knowledge/service/s3.service";
import { DocumentService } from "../../document/service/document.service";
import { AgentToolService } from "../../agent/service/agent-tool.service";
import { ProviderRouter } from "../../providers/provider-router";
import { ModelRegistryService } from "../../config/model-registry.service";
import { PrismaService } from "../../prisma/prisma.service";
import { createFastifyApp, createTestModule } from "../../../../test/test-module";
import { resetDatabase } from "../../../../test/test-database";
import { createAgent, createUser } from "../../../../test/factories";
import { AgentRunPolicyService } from "../../agent/service/agent-run-policy.service";
import { WorkspaceQuotaService } from "../../workspace/service/workspace-quota.service";
import { asSessionUser } from "../../../../test/as-session-user";

// RNX-126: GET /channels/deleted and POST /channels/:id/restore (session, the owner only, as DELETE /channels/:id).
// Real controller and ChannelService on the test database; the chat, upload and document collaborators are not used
// by these routes (their modules load ESM-only packages). `all` reads the rows as they are.
jest.mock("../service/channel-chat.service", () => ({ ChannelChatService: class {} }));
jest.mock("../../knowledge/service/s3.service", () => ({ S3Service: class {} }));
jest.mock("../../document/service/document.service", () => ({ DocumentService: class {} }));
jest.mock("../../agent/service/agent-tool.service", () => ({ AgentToolService: class {} }));

describe("RNX-126: the owner lists and restores deleted channels (Fastify, test database)", () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let all: PrismaService;
  let app: NestFastifyApplication;

  beforeAll(async () => {
    ({ moduleRef, prisma } = await createTestModule({
      controllers: [ChannelController],
      providers: [
        ChannelService,
        AgentRunPolicyService,
        WorkspaceQuotaService,
        { provide: ChannelChatService, useValue: {} },
        { provide: S3Service, useValue: {} },
        { provide: DocumentService, useValue: {} },
        { provide: AgentToolService, useValue: {} },
        { provide: ProviderRouter, useValue: {} },
        { provide: ModelRegistryService, useValue: {} },
      ],
    }));
    app = await createFastifyApp(moduleRef);
    all = PrismaService.create({});
  });

  beforeEach(() => resetDatabase(prisma));

  afterAll(async () => {
    await app?.close();
    await all?.$disconnect();
  });

  const call = (method: "GET" | "POST" | "DELETE", url: string, user: { id: string; email: string }) =>
    app.inject({ method, url, headers: asSessionUser(user) });
  const ids = async (url: string, user: { id: string; email: string }) =>
    (await call("GET", url, user)).json().map((row: { id: string }) => row.id);
  const channelRows = () => all.channel.findMany({ orderBy: { id: "asc" } });

  const setup = async () => {
    const alice = await createUser(prisma);
    const bob = await createUser(prisma);
    const agent = await createAgent(prisma, { userId: alice.id });
    const channel = await prisma.channel.create({ data: { userId: alice.id, name: "Alice channel" } });
    await prisma.channelAgent.create({ data: { channelId: channel.id, agentId: agent.id } });
    const room = await prisma.channelChatRoom.create({ data: { channelId: channel.id } });
    return { alice, bob, agent, channel, room };
  };

  it("RNX-126: the list gives id, name, deletedAt and purgeAt = deletedAt + 30 days, newest-deleted first", async () => {
    const { alice, channel } = await setup();
    const older = await prisma.channel.create({ data: { userId: alice.id, name: "Older" } });
    await all.channel.update({ where: { id: older.id }, data: { deletedAt: new Date("2026-11-01T00:00:00.000Z"), deletedById: alice.id } });
    await all.channel.update({ where: { id: channel.id }, data: { deletedAt: new Date("2026-11-07T15:45:00.000Z"), deletedById: alice.id } });

    const res = await call("GET", "/channels/deleted", alice);

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual([
      { id: channel.id, name: "Alice channel", deletedAt: "2026-11-07T15:45:00.000Z", purgeAt: "2026-12-07T15:45:00.000Z" },
      { id: older.id, name: "Older", deletedAt: "2026-11-01T00:00:00.000Z", purgeAt: "2026-12-01T00:00:00.000Z" },
    ]);
  });

  it("RNX-126 AC1: after restore the channel is back in the list and the read with its agent link; its room stays", async () => {
    const { alice, agent, channel, room } = await setup();
    expect((await call("DELETE", `/channels/${channel.id}`, alice)).statusCode).toBe(204);

    const res = await call("POST", `/channels/${channel.id}/restore`, alice);

    expect([res.statusCode, res.json()]).toEqual([200, { id: channel.id, name: "Alice channel" }]);
    expect(await ids("/channels/deleted", alice)).toEqual([]);
    expect(await ids("/channels", alice)).toEqual([channel.id]);
    const read = await call("GET", `/channels/${channel.id}`, alice);
    expect(read.json().agents.map((a: { agentId: string }) => a.agentId)).toEqual([agent.id]);
    expect(await all.channelChatRoom.findMany({ where: { channelId: channel.id }, select: { id: true } })).toEqual([{ id: room.id }]);
  });

  it("RNX-126 AC2: another user's deleted channel is not listed and its restore answers 404; nothing changes", async () => {
    const { alice, bob, channel } = await setup();
    expect((await call("DELETE", `/channels/${channel.id}`, alice)).statusCode).toBe(204);
    const before = await channelRows();

    const listed = await ids("/channels/deleted", bob);
    const res = await call("POST", `/channels/${channel.id}/restore`, bob);

    expect(listed).toEqual([]);
    expect([res.statusCode, res.json().message]).toEqual([404, "Channel not found"]);
    expect(await channelRows()).toEqual(before);
  });

  it("RNX-126 AC3: restore on a live channel answers 404; nothing changes", async () => {
    const { alice, channel } = await setup();
    const before = await channelRows();

    const res = await call("POST", `/channels/${channel.id}/restore`, alice);

    expect([res.statusCode, res.json().message]).toEqual([404, "Channel not found"]);
    expect(await channelRows()).toEqual(before);
  });
});
