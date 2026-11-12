import { TestingModule } from "@nestjs/testing";
import { NestFastifyApplication } from "@nestjs/platform-fastify";
import { WorkspaceController } from "./workspace.controller";
import { WorkspaceService } from "../service/workspace.service";
import { WorkspaceMemberService } from "../service/workspace-member.service";
import { WorkspaceInviteService } from "../service/workspace-invite.service";
import { WorkspaceQuotaService } from "../service/workspace-quota.service";
import { WorkspaceMcpConnectionRepository } from "../../mcp/repository/workspace-mcp-connection.repository";
import { EmailJobService } from "../../email/service/email-job.service";
import { PrismaService } from "../../prisma/prisma.service";
import { createFastifyApp, createTestModule } from "../../../../test/test-module";
import { resetDatabase } from "../../../../test/test-database";
import { createPackageSnapshot, createUser, createWorkspace } from "../../../../test/factories";
import { asSessionUser } from "../../../../test/as-session-user";

// RNX-292 (D312): a workspace's MCP switches (workspace_mcp_connections) go when the workspace is deleted (the RNX-125
// soft delete, in the same transaction as its marker) and a member's go when that member is removed from it (DELETE
// /workspaces/:id/members/:memberId, or PATCH with status "removed"). Every account credential stays, and so does a
// switch of another workspace or another member. Real controller and services, test database; email sending is a stub.
jest.mock("../../email/service/email-job.service", () => ({ EmailJobService: class {} }));

type Actor = { id: string; email: string };

describe("RNX-292: workspace delete and member removal take the MCP switches with them (Fastify, test database)", () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let app: NestFastifyApplication;

  beforeAll(async () => {
    ({ moduleRef, prisma } = await createTestModule({
      controllers: [WorkspaceController],
      providers: [
        WorkspaceService,
        WorkspaceMemberService,
        WorkspaceInviteService,
        WorkspaceQuotaService,
        { provide: EmailJobService, useValue: { enqueue: async () => undefined } },
      ],
    }));
    app = await createFastifyApp(moduleRef);
  });

  beforeEach(() => resetDatabase(prisma));

  afterEach(() => jest.restoreAllMocks());

  afterAll(() => app?.close());

  const call = (actor: Actor, method: "DELETE" | "PATCH", url: string, payload?: object) =>
    app.inject({ method, url, headers: asSessionUser(actor), payload });

  /**
   * An Enterprise owner's workspaces A and B, with members x and y in both. Credentials (account-level): x's gmail on in
   * A and B, x's notion on in A, y's gmail on in A, the owner's github on in A and B.
   */
  const seed = async () => {
    const owner = await createUser(prisma);
    await createPackageSnapshot(prisma, { userId: owner.id, collaborationEnabled: true });
    const [x, y] = [await createUser(prisma), await createUser(prisma)];
    const a = await createWorkspace(prisma, { ownerId: owner.id });
    const b = await createWorkspace(prisma, { ownerId: owner.id });
    const memberIds: Record<string, string> = {};
    for (const workspace of [a, b]) {
      for (const user of [owner, x, y]) {
        const member = await prisma.workspaceMember.create({
          data: { workspaceId: workspace.id, userId: user.id, role: user === owner ? "owner" : "member", status: "active", joinedAt: new Date() },
        });
        memberIds[`${workspace.id}:${user.id}`] = member.id;
      }
    }
    const credential = (userId: string, provider: string, workspaceIds: string[]) =>
      prisma.userMcpCredential.create({
        data: { userId, provider, envEncrypted: "sealed", workspaceConnections: { create: workspaceIds.map((workspaceId) => ({ workspaceId })) } },
      });
    await credential(x.id, "google-gmail", [a.id, b.id]);
    await credential(x.id, "notion", [a.id]);
    await credential(y.id, "google-gmail", [a.id]);
    await credential(owner.id, "github", [a.id, b.id]);
    return { owner, x, y, a, b, memberOf: (workspaceId: string, userId: string) => memberIds[`${workspaceId}:${userId}`] };
  };

  const credentials = () => prisma.userMcpCredential.findMany({ orderBy: { id: "asc" } });

  /** The switches, as (user, provider, workspace), sorted. */
  const switches = async () =>
    (await prisma.workspaceMcpConnection.findMany({ include: { credential: true } }))
      .map((c) => `${c.credential.userId}:${c.credential.provider}:${c.workspaceId}`)
      .sort();

  const switchOf = (userId: string, provider: string, workspaceId: string) => `${userId}:${provider}:${workspaceId}`;

  it("AC 9: deleting A removes A's switch rows (and only them); every member's account credential is unchanged", async () => {
    const { owner, x, y, a, b } = await seed();
    const credentialsBefore = await credentials();

    const res = await call(owner, "DELETE", `/workspaces/${a.id}`);

    expect(res.statusCode).toBe(200);
    expect(await credentials()).toEqual(credentialsBefore);
    expect(await switches()).toEqual([switchOf(x.id, "google-gmail", b.id), switchOf(owner.id, "github", b.id)].sort());
    expect(await prisma.workspaceMcpConnection.count({ where: { workspaceId: a.id } })).toBe(0);
    expect((await prisma.workspaceMember.findMany({ where: { userId: y.id } })).every((m) => m.status === "active")).toBe(true);
  });

  it("AC 9: the switches go in the delete's transaction: a failure right after the cleanup rolls back the marker and the cleanup", async () => {
    const { owner, a } = await seed();
    const switchesBefore = await switches();
    const repository = moduleRef.get(WorkspaceMcpConnectionRepository);
    const deleteWorkspaceConnections = repository.deleteWorkspaceConnections.bind(repository);
    jest.spyOn(repository, "deleteWorkspaceConnections").mockImplementation(async (...args) => {
      await deleteWorkspaceConnections(...args);
      throw new Error("rnx292 planted failure after the cleanup");
    });

    const res = await call(owner, "DELETE", `/workspaces/${a.id}`);

    expect(res.statusCode).toBe(500);
    expect(await prisma.workspace.findUnique({ where: { id: a.id } })).not.toBeNull();
    expect(await switches()).toEqual(switchesBefore);
  });

  it.each([
    ["DELETE /workspaces/:id/members/:memberId", (s: Awaited<ReturnType<typeof seed>>) => call(s.owner, "DELETE", `/workspaces/${s.a.id}/members/${s.memberOf(s.a.id, s.x.id)}`)],
    [
      "PATCH /workspaces/:id/members/:memberId with status removed",
      (s: Awaited<ReturnType<typeof seed>>) => call(s.owner, "PATCH", `/workspaces/${s.a.id}/members/${s.memberOf(s.a.id, s.x.id)}`, { status: "removed" }),
    ],
  ])("AC 13: %s: x loses their switches in A; their switches elsewhere, their credentials and the others' switches are unchanged", async (_route, remove) => {
    const s = await seed();
    const credentialsBefore = await credentials();

    const res = await remove(s);

    expect(res.statusCode).toBe(200);
    expect(await credentials()).toEqual(credentialsBefore);
    expect(await switches()).toEqual(
      [
        switchOf(s.x.id, "google-gmail", s.b.id),
        switchOf(s.y.id, "google-gmail", s.a.id),
        switchOf(s.owner.id, "github", s.a.id),
        switchOf(s.owner.id, "github", s.b.id),
      ].sort(),
    );
  });

  it("AC 13 (control): a PATCH that only changes the role keeps the member's switches", async () => {
    const s = await seed();
    const before = await switches();

    const res = await call(s.owner, "PATCH", `/workspaces/${s.a.id}/members/${s.memberOf(s.a.id, s.x.id)}`, { role: "member" });

    expect(res.statusCode).toBe(200);
    expect(await switches()).toEqual(before);
  });
});
