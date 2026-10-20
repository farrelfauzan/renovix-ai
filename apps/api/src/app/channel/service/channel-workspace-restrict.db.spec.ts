import { TestingModule } from "@nestjs/testing";
import { PrismaService } from "../../prisma/prisma.service";
import { createTestModule } from "../../../../test/test-module";
import { resetDatabase } from "../../../../test/test-database";
import { createUser, createWorkspace } from "../../../../test/factories";

// RNX-202 (D95): Workspace.channel is onDelete Restrict, so the database itself refuses to delete a channel that has a
// workspace, even when ChannelService.delete's 409 guard (RX-144) is bypassed, as in its read-then-delete race. A
// channel without a workspace is deleted as before. Test database.
describe("RNX-202: the database refuses to delete a channel that has a workspace (test database)", () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;

  beforeAll(async () => {
    ({ moduleRef, prisma } = await createTestModule({}));
  });

  beforeEach(() => resetDatabase(prisma));

  afterAll(() => moduleRef?.close());

  const rowCounts = async () =>
    Promise.all([
      prisma.channel.count(),
      prisma.workspace.count(),
      prisma.workspaceMember.count(),
      prisma.workspaceInvite.count(),
      prisma.workspaceMemory.count(),
      prisma.knowledgeBase.count(),
    ]);

  it("a channel with a workspace (member, invite, memory, knowledge base): the delete fails with a foreign-key error and every row stays", async () => {
    const alice = await createUser(prisma);
    const bob = await createUser(prisma);
    const channel = await prisma.channel.create({ data: { userId: alice.id, name: "Room" } });
    const workspace = await createWorkspace(prisma, { ownerId: alice.id, channelId: channel.id });
    await prisma.workspaceMember.create({ data: { workspaceId: workspace.id, userId: alice.id, role: "owner" } });
    await prisma.workspaceMember.create({ data: { workspaceId: workspace.id, userId: bob.id } });
    await prisma.workspaceInvite.create({
      data: {
        workspaceId: workspace.id,
        email: "carol@test.local",
        emailNormalized: "carol@test.local",
        tokenHash: "rnx202-token-hash",
        expiresAt: new Date(Date.now() + 86_400_000),
        invitedById: alice.id,
      },
    });
    await prisma.workspaceMemory.create({ data: { workspaceId: workspace.id, type: "fact", content: "kept" } });
    await prisma.knowledgeBase.create({ data: { userId: alice.id, workspaceId: workspace.id, name: "Workspace KB" } });
    const countsBefore = await rowCounts();

    const deleting = prisma.channel.delete({ where: { id: channel.id } });

    await expect(deleting).rejects.toMatchObject({ code: "P2003" });
    expect(await rowCounts()).toEqual(countsBefore);
    expect(countsBefore).toEqual([1, 1, 2, 1, 1, 1]);
  });

  it("control: a channel without a workspace is deleted as before", async () => {
    const alice = await createUser(prisma);
    const channel = await prisma.channel.create({ data: { userId: alice.id, name: "Plain room" } });

    await prisma.channel.delete({ where: { id: channel.id } });

    expect(await prisma.channel.count()).toBe(0);
  });
});
