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
import { PlatformSettingsService } from "../../offers/service/platform-settings.service";
import { DocumentService } from "../../document/service/document.service";
import { EmailJobService } from "../../email/service/email-job.service";
import { EmbeddingService } from "../../knowledge/service/embedding.service";
import { S3Service } from "../../knowledge/service/s3.service";
import { ChannelRepository } from "../../channel/repository/channel.repository";
import { PrismaService } from "../../prisma/prisma.service";
import { TransactionService } from "../../prisma/transaction.service";
import { createFastifyApp, createTestModule } from "../../../../test/test-module";
import { resetDatabase } from "../../../../test/test-database";
import { createUser } from "../../../../test/factories";
import { asSessionUser } from "../../../../test/as-session-user";

// RNX-299: the lock's result decides. `lockLiveChannel` reports whether it locked a live row; when it did not, the
// workspace create and the channel delete answer 404 at once and read and write nothing else, even if a later read
// would find the channel live (a restore landing between the lock and the read). Real controllers and services, test
// database; `all` reads the rows as they are.
jest.mock("../../channel/service/channel-chat.service", () => ({ ChannelChatService: class {} }));
jest.mock("../../providers/provider-router", () => ({ ProviderRouter: class {} }));
jest.mock("../../config/model-registry.service", () => ({ ModelRegistryService: class {} }));
jest.mock("../../document/service/document.service", () => ({ DocumentService: class {} }));
jest.mock("../../email/service/email-job.service", () => ({ EmailJobService: class {} }));
jest.mock("../../knowledge/service/embedding.service", () => ({ EmbeddingService: class {} }));
jest.mock("../../knowledge/service/s3.service", () => ({ S3Service: class {} }));

type User = { id: string; email: string };

describe("RNX-299: the live-channel lock result decides the 404 of a workspace create and a channel delete (Fastify, test database)", () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let all: PrismaService;
  let app: NestFastifyApplication;
  let channelRepository: ChannelRepository;

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
        { provide: PlatformSettingsService, useValue: { getSetting: async () => null } },
        { provide: ModelRegistryService, useValue: {} },
        { provide: DocumentService, useValue: {} },
        { provide: EmailJobService, useValue: {} },
        { provide: EmbeddingService, useValue: {} },
        { provide: S3Service, useValue: {} },
      ],
    }));
    app = await createFastifyApp(moduleRef);
    all = PrismaService.create({});
    channelRepository = moduleRef.get(ChannelRepository);
  });

  beforeEach(() => resetDatabase(prisma));

  afterEach(() => jest.restoreAllMocks());

  afterAll(async () => {
    await app?.close();
    await all?.$disconnect();
  });

  const createChannelWorkspace = (channelId: string, user: User) =>
    app.inject({ method: "POST", url: `/channels/${channelId}/workspace`, headers: asSessionUser(user) });

  const deleteChannel = (channelId: string, user: User) =>
    app.inject({ method: "DELETE", url: `/channels/${channelId}`, headers: asSessionUser(user) });

  const readChannel = (channelId: string) => all.channel.findUniqueOrThrow({ where: { id: channelId } });

  const expectNoWorkspaceRows = async () => {
    expect(await all.workspace.count()).toBe(0);
    expect(await all.workspaceMember.count()).toBe(0);
  };

  describe("the lock's own result", () => {
    it("is true for a live channel, false for a deleted one and false for one that does not exist", async () => {
      const owner = await createUser(prisma);
      const live = await prisma.channel.create({ data: { userId: owner.id, name: "Live" } });
      const deleted = await prisma.channel.create({ data: { userId: owner.id, name: "Gone" } });
      await all.channel.update({ where: { id: deleted.id }, data: { deletedAt: new Date(), deletedById: owner.id } });
      const transactions = moduleRef.get(TransactionService);
      const lock = (channelId: string) => transactions.run((tx) => channelRepository.lockLiveChannel(channelId, tx));
      const actual = [await lock(live.id), await lock(deleted.id), await lock("00000000-0000-4000-8000-000000000000")];
      expect(actual).toEqual([true, false, false]);
    });
  });

  describe("AC1: a deleted channel", () => {
    it("its owner creating the workspace gets 404 'Server not found' and no workspace or member row is written", async () => {
      const owner = await createUser(prisma);
      const channel = await prisma.channel.create({ data: { userId: owner.id, name: "Gone" } });
      await all.channel.update({ where: { id: channel.id }, data: { deletedAt: new Date(), deletedById: owner.id } });
      const actual = await createChannelWorkspace(channel.id, owner);
      expect([actual.statusCode, actual.json().message]).toEqual([404, "Server not found"]);
      await expectNoWorkspaceRows();
    });

    it("its owner deleting it gets 404 'Channel not found' and the channel row is unchanged", async () => {
      const owner = await createUser(prisma);
      const channel = await prisma.channel.create({ data: { userId: owner.id, name: "Gone" } });
      await all.channel.update({ where: { id: channel.id }, data: { deletedAt: new Date(), deletedById: owner.id } });
      const before = await readChannel(channel.id);
      const actual = await deleteChannel(channel.id, owner);
      expect([actual.statusCode, actual.json().message]).toEqual([404, "Channel not found"]);
      const after = await readChannel(channel.id);
      expect([after.deletedAt, after.deletedById, after.updatedAt]).toEqual([before.deletedAt, before.deletedById, before.updatedAt]);
    });
  });

  describe("AC2: the lock finds no live row but the follow-up read would see a live channel", () => {
    it("create answers 404 'Server not found', writes nothing and never makes the follow-up read", async () => {
      const owner = await createUser(prisma);
      const channel = await prisma.channel.create({ data: { userId: owner.id, name: "Live" } });
      const before = await readChannel(channel.id);
      jest.spyOn(channelRepository, "lockLiveChannel").mockResolvedValue(false);
      const readSpy = jest.spyOn(channelRepository, "findChannelWithWorkspace");
      const actual = await createChannelWorkspace(channel.id, owner);
      expect([actual.statusCode, actual.json().message]).toEqual([404, "Server not found"]);
      expect(readSpy).not.toHaveBeenCalled();
      await expectNoWorkspaceRows();
      expect(await readChannel(channel.id)).toEqual(before);
    });

    it("delete answers 404 'Channel not found', writes nothing and never makes the follow-up read", async () => {
      const owner = await createUser(prisma);
      const channel = await prisma.channel.create({ data: { userId: owner.id, name: "Live" } });
      const before = await readChannel(channel.id);
      jest.spyOn(channelRepository, "lockLiveChannel").mockResolvedValue(false);
      const readSpy = jest.spyOn(channelRepository, "findUserChannelWorkspace");
      const actual = await deleteChannel(channel.id, owner);
      expect([actual.statusCode, actual.json().message]).toEqual([404, "Channel not found"]);
      expect(readSpy).not.toHaveBeenCalled();
      expect(await readChannel(channel.id)).toEqual(before);
    });
  });

  describe("AC4: a live channel behaves as before (the lock reports true)", () => {
    it("create answers 201 with the workspace and an owner member row", async () => {
      const owner = await createUser(prisma);
      const channel = await prisma.channel.create({ data: { userId: owner.id, name: "Team" } });
      const actual = await createChannelWorkspace(channel.id, owner);
      expect(actual.statusCode).toBe(201);
      const members = await all.workspaceMember.findMany({ where: { workspaceId: actual.json().id } });
      expect(members.map((m) => [m.userId, m.role])).toEqual([[owner.id, "owner"]]);
    });

    it("delete soft-deletes it (204), and answers 409 once it has a workspace", async () => {
      const owner = await createUser(prisma);
      const plain = await prisma.channel.create({ data: { userId: owner.id, name: "Plain" } });
      expect((await deleteChannel(plain.id, owner)).statusCode).toBe(204);
      expect((await readChannel(plain.id)).deletedById).toBe(owner.id);
      const withWorkspace = await prisma.channel.create({ data: { userId: owner.id, name: "Team" } });
      await createChannelWorkspace(withWorkspace.id, owner);
      const actual = await deleteChannel(withWorkspace.id, owner);
      expect([actual.statusCode, (await readChannel(withWorkspace.id)).deletedAt]).toEqual([409, null]);
    });
  });
});
