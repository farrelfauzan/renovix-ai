import { TestingModule } from "@nestjs/testing";
import { NestFastifyApplication } from "@nestjs/platform-fastify";
import { WorkspaceChannelController } from "./workspace-channel.controller";
import { WorkspaceService } from "../service/workspace.service";
import { WorkspaceMemberService } from "../service/workspace-member.service";
import { WorkspaceInviteService } from "../service/workspace-invite.service";
import { WorkspaceQuotaService } from "../service/workspace-quota.service";
import { WorkspaceKnowledgeService } from "../service/workspace-knowledge.service";
import { ChannelController } from "../../channel/controller/channel.controller";
import { ChannelService } from "../../channel/service/channel.service";
import { ChannelChatService } from "../../channel/service/channel-chat.service";
import { AgentRunPolicyService } from "../../agent/service/agent-run-policy.service";
import { ProviderRouter } from "../../providers/provider-router";
import { ModelRegistryService } from "../../config/model-registry.service";
import { DocumentService } from "../../document/service/document.service";
import { EmailJobService } from "../../email/service/email-job.service";
import { EmbeddingService } from "../../knowledge/service/embedding.service";
import { S3Service } from "../../knowledge/service/s3.service";
import { PrismaService } from "../../prisma/prisma.service";
import { createFastifyApp, createTestModule } from "../../../../test/test-module";
import { resetDatabase } from "../../../../test/test-database";
import { createUser, createWorkspace } from "../../../../test/factories";
import { asSessionUser } from "../../../../test/as-session-user";

// RNX-295: POST /channels/:channelId/workspace and DELETE /channels/:id race. Both run in one transaction under the
// channel's row lock, so the end state is never a live workspace on a deleted channel: either the workspace is created
// (201) and the delete answers 409 (RX-144), or the channel is deleted (204) and the create answers 404. A deleted
// channel gets no workspace (404, no row written), and a live channel's create answers as before. Real controllers and
// services, test database; the chat, provider, document, email, embedding and S3 services are never reached (stubs).
// `all` is a client with nothing on PrismaService's default filter map, to read the rows as they are.
jest.mock("../../channel/service/channel-chat.service", () => ({ ChannelChatService: class {} }));
jest.mock("../../providers/provider-router", () => ({ ProviderRouter: class {} }));
jest.mock("../../config/model-registry.service", () => ({ ModelRegistryService: class {} }));
jest.mock("../../document/service/document.service", () => ({ DocumentService: class {} }));
jest.mock("../../email/service/email-job.service", () => ({ EmailJobService: class {} }));
jest.mock("../../knowledge/service/embedding.service", () => ({ EmbeddingService: class {} }));
jest.mock("../../knowledge/service/s3.service", () => ({ S3Service: class {} }));

const RACE_ITERATIONS = 40;

type User = { id: string; email: string };

describe("RNX-295: a channel's workspace create and the channel's delete (Fastify, test database)", () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let all: PrismaService;
  let app: NestFastifyApplication;

  beforeAll(async () => {
    ({ moduleRef, prisma } = await createTestModule({
      controllers: [WorkspaceChannelController, ChannelController],
      providers: [
        WorkspaceService,
        WorkspaceMemberService,
        WorkspaceInviteService,
        WorkspaceQuotaService,
        WorkspaceKnowledgeService,
        ChannelService,
        AgentRunPolicyService,
        { provide: ChannelChatService, useValue: {} },
        { provide: ProviderRouter, useValue: {} },
        { provide: ModelRegistryService, useValue: {} },
        { provide: DocumentService, useValue: {} },
        { provide: EmailJobService, useValue: {} },
        { provide: EmbeddingService, useValue: {} },
        { provide: S3Service, useValue: {} },
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

  const createChannelWorkspace = (channelId: string, user: User) =>
    app.inject({ method: "POST", url: `/channels/${channelId}/workspace`, headers: asSessionUser(user) });

  const deleteChannel = (channelId: string, user: User) =>
    app.inject({ method: "DELETE", url: `/channels/${channelId}`, headers: asSessionUser(user) });

  /** The channel, its workspaces and their members, read as they are (deleted ones included). */
  const readRows = async (channelId: string) => {
    const channel = await all.channel.findUniqueOrThrow({ where: { id: channelId } });
    const workspaces = await all.workspace.findMany({ where: { channelId } });
    const members = await all.workspaceMember.findMany({ where: { workspaceId: { in: workspaces.map((w) => w.id) } } });
    return { channel, workspaces, members };
  };

  it("AC1: the owner creating a workspace on a soft-deleted channel gets 404 and no workspace or member row is written", async () => {
    const owner = await createUser(prisma);
    const channel = await prisma.channel.create({ data: { userId: owner.id, name: "Gone" } });
    expect((await deleteChannel(channel.id, owner)).statusCode).toBe(204);
    const actual = await createChannelWorkspace(channel.id, owner);
    expect([actual.statusCode, actual.json().message]).toEqual([404, "Server not found"]);
    expect(await all.workspace.count()).toBe(0);
    expect(await all.workspaceMember.count()).toBe(0);
  });

  it(`AC2: create and delete at once, ${RACE_ITERATIONS} times in both orders, never leave a live workspace on a deleted channel`, async () => {
    const owner = await createUser(prisma);
    const outcomes: Record<string, number> = {};
    for (let i = 0; i < RACE_ITERATIONS; i++) {
      const channel = await prisma.channel.create({ data: { userId: owner.id, name: `Race ${i}` } });
      const calls = [() => createChannelWorkspace(channel.id, owner), () => deleteChannel(channel.id, owner)];
      const ordered = i % 2 === 0 ? calls : [...calls].reverse();
      const answers = await Promise.all(ordered.map((call) => call()));
      const [created, deleted] = i % 2 === 0 ? answers : [...answers].reverse();
      const rows = await readRows(channel.id);
      const outcome = `create ${created.statusCode} / delete ${deleted.statusCode}`;
      outcomes[outcome] = (outcomes[outcome] ?? 0) + 1;
      const actual = {
        i,
        outcome,
        channelDeleted: rows.channel.deletedAt !== null,
        liveWorkspaces: rows.workspaces.filter((w) => w.deletedAt === null).length,
        members: rows.members.length,
      };
      expect(actual).toEqual(
        created.statusCode === 201
          ? { i, outcome: "create 201 / delete 409", channelDeleted: false, liveWorkspaces: 1, members: 1 }
          : { i, outcome: "create 404 / delete 204", channelDeleted: true, liveWorkspaces: 0, members: 0 },
      );
    }
    console.log(`RNX-295 race outcomes over ${RACE_ITERATIONS} iterations: ${JSON.stringify(outcomes)}`);
  });

  describe("AC4: a live channel's create behaves as before", () => {
    it("the owner gets 201 with the workspace row and an active owner member row joined now", async () => {
      const owner = await createUser(prisma);
      const channel = await prisma.channel.create({ data: { userId: owner.id, name: "My Team!" } });
      const before = Date.now();
      const actual = await createChannelWorkspace(channel.id, owner);
      expect(actual.statusCode).toBe(201);
      const { workspaces, members } = await readRows(channel.id);
      expect(workspaces).toHaveLength(1);
      expect(actual.json()).toEqual(JSON.parse(JSON.stringify(workspaces[0])));
      expect(workspaces[0]).toMatchObject({ channelId: channel.id, ownerId: owner.id, name: "My Team!", slug: "my-team", deletedAt: null });
      expect(members).toHaveLength(1);
      expect(members[0]).toMatchObject({ workspaceId: workspaces[0].id, userId: owner.id, role: "owner", status: "active" });
      expect(members[0].joinedAt?.getTime()).toBeGreaterThanOrEqual(before - 1000);
    });

    it("404 'Server not found' for a missing channel", async () => {
      const owner = await createUser(prisma);
      const actual = await createChannelWorkspace("00000000-0000-4000-8000-000000000000", owner);
      expect([actual.statusCode, actual.json().message]).toEqual([404, "Server not found"]);
      expect(await all.workspace.count()).toBe(0);
    });

    it("404 'Workspace not found' when the channel's workspace is deleted, and nothing is written", async () => {
      const owner = await createUser(prisma);
      const channel = await prisma.channel.create({ data: { userId: owner.id, name: "Team" } });
      const workspace = await createWorkspace(prisma, { ownerId: owner.id, channelId: channel.id });
      await all.workspace.update({ where: { id: workspace.id }, data: { deletedAt: new Date(), deletedById: owner.id } });
      const actual = await createChannelWorkspace(channel.id, owner);
      expect([actual.statusCode, actual.json().message]).toEqual([404, "Workspace not found"]);
      expect(await all.workspace.count()).toBe(1);
      expect(await all.workspaceMember.count()).toBe(0);
    });

    it("403 for anyone but the channel's owner, and nothing is written", async () => {
      const owner = await createUser(prisma);
      const stranger = await createUser(prisma);
      const channel = await prisma.channel.create({ data: { userId: owner.id, name: "Team" } });
      const actual = await createChannelWorkspace(channel.id, stranger);
      expect([actual.statusCode, actual.json().message]).toEqual([403, "Only the server owner can create a workspace"]);
      expect(await all.workspace.count()).toBe(0);
    });

    it("returns the existing workspace when the channel has one, and writes nothing", async () => {
      const owner = await createUser(prisma);
      const channel = await prisma.channel.create({ data: { userId: owner.id, name: "Team" } });
      const workspace = await createWorkspace(prisma, { ownerId: owner.id, channelId: channel.id });
      const actual = await createChannelWorkspace(channel.id, owner);
      expect(actual.statusCode).toBe(201);
      expect(actual.json()).toEqual(JSON.parse(JSON.stringify(await all.workspace.findUniqueOrThrow({ where: { id: workspace.id } }))));
      expect(await all.workspace.count()).toBe(1);
      expect(await all.workspaceMember.count()).toBe(0);
    });
  });
});
