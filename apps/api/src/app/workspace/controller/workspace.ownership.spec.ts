import { TestingModule } from "@nestjs/testing";
import { NestFastifyApplication } from "@nestjs/platform-fastify";
import { WorkspaceController } from "./workspace.controller";
import { WorkspaceChannelController } from "./workspace-channel.controller";
import { WorkspaceService } from "../service/workspace.service";
import { WorkspaceMemberService } from "../service/workspace-member.service";
import { WorkspaceInviteService } from "../service/workspace-invite.service";
import { WorkspaceQuotaService } from "../service/workspace-quota.service";
import { WorkspaceKnowledgeService } from "../service/workspace-knowledge.service";
import { EmailJobService } from "../../email/service/email-job.service";
import { EmbeddingService } from "../../knowledge/service/embedding.service";
import { S3Service } from "../../knowledge/service/s3.service";
import { PrismaService } from "../../prisma/prisma.service";
import { createFastifyApp, createTestModule } from "../../../../test/test-module";
import { resetDatabase } from "../../../../test/test-database";
import { createPackageSnapshot, createPlan, createSubscription, createUser, createWorkspace } from "../../../../test/factories";
import { asSessionUser } from "../../../../test/as-session-user";

// RX-15 characterization: workspace membership and roles as they are today,
// through the real controllers and services (CombinedAuthGuard session path, test
// database). Roles: owner | admin | member | viewer; membership status
// active | removed. Checks: WorkspaceService.requireMembership / requireRole,
// WorkspaceChannelController.resolveWorkspace. Embeddings are a zero-vector
// stub (no provider call); email sending is never reached. RNX-260 (D259, D81):
// requireRole decides by workspace.ownerId, so an "admin" or "viewer" row is a
// collaborator (member): every owner-or-admin route is the owner's only, and
// the member DTOs accept only "member" (400 for "admin" or "viewer").
jest.mock("../../../lib/auth", () => ({ auth: { api: { getSession: async () => null } } }));
jest.mock("../../email/service/email-job.service", () => ({ EmailJobService: class {} }));
jest.mock("../../knowledge/service/embedding.service", () => ({ EmbeddingService: class {} }));
jest.mock("../../knowledge/service/s3.service", () => ({ S3Service: class {} }));

type Actor = "owner" | "admin" | "member" | "viewer" | "removed" | "outsider";
const MEMBERS: Actor[] = ["owner", "admin", "member", "viewer"];
const NON_MEMBERS: Actor[] = ["removed", "outsider"];

describe("Workspaces: membership and roles (RX-15, Fastify, test database)", () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let app: NestFastifyApplication;
  const zero = () => ({ embedding: new Array(1024).fill(0), tokenCount: 1 });

  beforeAll(async () => {
    ({ moduleRef, prisma } = await createTestModule({
      controllers: [WorkspaceController, WorkspaceChannelController],
      providers: [
        WorkspaceService,
        WorkspaceMemberService,
        WorkspaceInviteService,
        WorkspaceQuotaService,
        WorkspaceKnowledgeService,
        { provide: EmailJobService, useValue: {} },
        {
          provide: EmbeddingService,
          useValue: { embed: async (texts: string[]) => texts.map(zero) },
        },
        { provide: S3Service, useValue: {} },
      ],
    }));
    app = await createFastifyApp(moduleRef);
  });

  beforeEach(() => resetDatabase(prisma));

  afterAll(() => app?.close());

  const auth = (user: { id: string; email: string }) => asSessionUser(user);

  // One workspace (linked to the owner's channel) with one user per actor.
  const setup = async () => {
    const users = {} as Record<Actor, { id: string; email: string }>;
    for (const actor of [...MEMBERS, ...NON_MEMBERS]) users[actor] = await createUser(prisma);
    // RX-113: only an Enterprise owner's workspace has other members (D64).
    // These tests are about roles, so the owner is on Enterprise; the
    // Starter/Pro rules are in workspace.collaboration.spec.ts.
    const enterprise = await createPlan(prisma, { slug: "enterprise", maxWorkspaceUsers: 100 });
    await createSubscription(prisma, { userId: users.owner.id, planId: enterprise.id });
    // RNX-76 B3 (D297): collaboration comes from the owner's package snapshot, not the plan.
    await createPackageSnapshot(prisma, { userId: users.owner.id, collaborationEnabled: true });
    const channel = await prisma.channel.create({ data: { userId: users.owner.id, name: "Team" } });
    const workspace = await createWorkspace(prisma, { ownerId: users.owner.id, channelId: channel.id });
    const memberIds = {} as Record<string, string>;
    for (const role of [...MEMBERS, "removed"] as const) {
      const row = await prisma.workspaceMember.create({
        data: {
          workspaceId: workspace.id,
          userId: users[role].id,
          role: role === "removed" ? "member" : role,
          status: role === "removed" ? "removed" : "active",
          joinedAt: new Date(),
        },
      });
      memberIds[role] = row.id;
    }
    const as = (actor: Actor) => auth(users[actor]);
    return { users, channel, workspace, memberIds, as };
  };

  // expected status per actor; anything not listed is 403
  const expectFor = (allowed: Partial<Record<Actor, number>>, actor: Actor) => allowed[actor] ?? 403;

  it.each([
    ["GET", "/workspaces"],
    ["GET", "/workspaces/00000000-0000-4000-8000-000000000000"],
    ["PATCH", "/workspaces/00000000-0000-4000-8000-000000000000"],
    ["GET", "/channels/00000000-0000-4000-8000-000000000000/workspace"],
  ] as const)("not signed in: %s %s is 401", async (method, url) => {
    const res = await app.inject({ method, url, payload: method === "PATCH" ? {} : undefined });

    expect(res.statusCode).toBe(401);
  });

  describe("/workspaces/:id (WorkspaceController)", () => {
    it.each([...MEMBERS, ...NON_MEMBERS])("GET /workspaces/:id as %s", async (actor) => {
      const { workspace, as } = await setup();

      const res = await app.inject({ method: "GET", url: `/workspaces/${workspace.id}`, headers: as(actor) });

      // getById filters on active membership: non-members get 404, not 403
      expect(res.statusCode).toBe(MEMBERS.includes(actor) ? 200 : 404);
    });

    it.each([...MEMBERS, ...NON_MEMBERS])("GET /workspaces lists it for %s only when an active member", async (actor) => {
      const { workspace, as } = await setup();

      const res = await app.inject({ method: "GET", url: "/workspaces", headers: as(actor) });

      expect(res.json().map((w: { id: string }) => w.id)).toEqual(MEMBERS.includes(actor) ? [workspace.id] : []);
    });

    it.each([...MEMBERS, ...NON_MEMBERS])("GET members and quota as %s", async (actor) => {
      const { workspace, as } = await setup();

      const members = await app.inject({ method: "GET", url: `/workspaces/${workspace.id}/members`, headers: as(actor) });
      const quota = await app.inject({ method: "GET", url: `/workspaces/${workspace.id}/quota`, headers: as(actor) });

      const expected = MEMBERS.includes(actor) ? 200 : 403;
      expect([members.statusCode, quota.statusCode]).toEqual([expected, expected]);
    });

    it.each([...MEMBERS, ...NON_MEMBERS])("PATCH /workspaces/:id as %s (owner only; RNX-260: an admin row is 403)", async (actor) => {
      const { workspace, as } = await setup();

      const res = await app.inject({
        method: "PATCH",
        url: `/workspaces/${workspace.id}`,
        headers: as(actor),
        payload: { description: `changed by ${actor}` },
      });

      const expected = expectFor({ owner: 200 }, actor);
      expect(res.statusCode).toBe(expected);
      const after = await prisma.workspace.findUnique({ where: { id: workspace.id } });
      expect(after?.description).toBe(expected === 200 ? `changed by ${actor}` : null);
    });

    it.each([...MEMBERS, ...NON_MEMBERS])("DELETE /workspaces/:id (archive) as %s (owner only)", async (actor) => {
      const { workspace, as } = await setup();

      const res = await app.inject({ method: "DELETE", url: `/workspaces/${workspace.id}`, headers: as(actor) });

      const expected = expectFor({ owner: 200 }, actor);
      expect(res.statusCode).toBe(expected);
      const after = await prisma.workspace.findUnique({ where: { id: workspace.id } });
      expect(after?.status).toBe(expected === 200 ? "archived" : "active");
    });

    it.each([...MEMBERS, ...NON_MEMBERS])("PATCH and DELETE a member (the viewer) as %s (owner only; RNX-260: an admin row is 403)", async (actor) => {
      const { workspace, memberIds, as } = await setup();

      const patch = await app.inject({
        method: "PATCH",
        url: `/workspaces/${workspace.id}/members/${memberIds.viewer}`,
        headers: as(actor),
        payload: { role: "member" },
      });
      const del = await app.inject({
        method: "DELETE",
        url: `/workspaces/${workspace.id}/members/${memberIds.viewer}`,
        headers: as(actor),
      });

      const expected = expectFor({ owner: 200 }, actor);
      expect([patch.statusCode, del.statusCode]).toEqual([expected, expected]);
      const viewer = await prisma.workspaceMember.findUnique({ where: { id: memberIds.viewer } });
      expect(viewer).toMatchObject(
        expected === 200 ? { role: "member", status: "removed" } : { role: "viewer", status: "active" },
      );
    });

    it.each([...MEMBERS, ...NON_MEMBERS])("GET invites as %s (owner only; RNX-260: an admin row is 403); POST invites is denied before validation for others", async (actor) => {
      const { workspace, as } = await setup();

      const list = await app.inject({ method: "GET", url: `/workspaces/${workspace.id}/invites`, headers: as(actor) });
      const create = await app.inject({
        method: "POST",
        url: `/workspaces/${workspace.id}/invites`,
        headers: as(actor),
        payload: {},
      });

      const expected = expectFor({ owner: 200 }, actor);
      expect(list.statusCode).toBe(expected);
      // the owner passes the role check and then fails body validation (400)
      expect(create.statusCode).toBe(expected === 200 ? 400 : 403);
    });

    it("an admin row cannot change or remove the owner (RNX-260: 403, was 400 after the role check)", async () => {
      const { workspace, memberIds, as } = await setup();

      const patch = await app.inject({
        method: "PATCH",
        url: `/workspaces/${workspace.id}/members/${memberIds.owner}`,
        headers: as("admin"),
        payload: { role: "member" },
      });
      const del = await app.inject({
        method: "DELETE",
        url: `/workspaces/${workspace.id}/members/${memberIds.owner}`,
        headers: as("admin"),
      });

      expect([patch.statusCode, del.statusCode]).toEqual([403, 403]);
      expect(await prisma.workspaceMember.findUnique({ where: { id: memberIds.owner } })).toMatchObject({
        role: "owner",
        status: "active",
      });
    });

    it("the owner's own member row cannot be changed or removed (400)", async () => {
      const { workspace, memberIds, as } = await setup();

      const patch = await app.inject({
        method: "PATCH",
        url: `/workspaces/${workspace.id}/members/${memberIds.owner}`,
        headers: as("owner"),
        payload: { role: "member" },
      });
      const del = await app.inject({
        method: "DELETE",
        url: `/workspaces/${workspace.id}/members/${memberIds.owner}`,
        headers: as("owner"),
      });

      expect([patch.statusCode, del.statusCode]).toEqual([400, 400]);
    });

    it("an admin row can no longer promote or demote anyone (RNX-260: 403, was 200), and the rows stay", async () => {
      const { workspace, memberIds, as } = await setup();

      const promote = await app.inject({
        method: "PATCH",
        url: `/workspaces/${workspace.id}/members/${memberIds.member}`,
        headers: as("admin"),
        payload: { role: "member" },
      });
      const demote = await app.inject({
        method: "PATCH",
        url: `/workspaces/${workspace.id}/members/${memberIds.admin}`,
        headers: as("admin"),
        payload: { status: "removed" },
      });

      expect([promote.statusCode, demote.statusCode]).toEqual([403, 403]);
      const rows = await prisma.workspaceMember.findMany({ where: { id: { in: [memberIds.member, memberIds.admin] } } });
      expect(rows.map((r) => [r.role, r.status]).sort()).toEqual([
        ["admin", "active"],
        ["member", "active"],
      ]);
    });

    it.each(["admin", "viewer"])(
      "RNX-260: the owner giving a member the role %s → 400, the row unchanged (only \"member\" is accepted)",
      async (role) => {
        const { workspace, memberIds, as } = await setup();

        const res = await app.inject({
          method: "PATCH",
          url: `/workspaces/${workspace.id}/members/${memberIds.member}`,
          headers: as("owner"),
          payload: { role },
        });

        expect(res.statusCode).toBe(400);
        expect(await prisma.workspaceMember.findUnique({ where: { id: memberIds.member } })).toMatchObject({ role: "member" });
      },
    );

    it.each(["admin", "viewer"])("RNX-260: the owner inviting with the role %s → 400, no invite stored", async (role) => {
      const { workspace, as } = await setup();

      const res = await app.inject({
        method: "POST",
        url: `/workspaces/${workspace.id}/invites`,
        headers: as("owner"),
        payload: { email: "new-person@test.local", role },
      });

      expect(res.statusCode).toBe(400);
      expect(await prisma.workspaceInvite.count()).toBe(0);
    });

    it("the owner of one workspace cannot change a member of another workspace through their own (404)", async () => {
      const { workspace, as, users } = await setup();
      const other = await createWorkspace(prisma, { ownerId: users.outsider.id });
      const otherMember = await prisma.workspaceMember.create({
        data: { workspaceId: other.id, userId: users.outsider.id, role: "member" },
      });

      const res = await app.inject({
        method: "PATCH",
        url: `/workspaces/${workspace.id}/members/${otherMember.id}`,
        headers: as("owner"),
        payload: { status: "removed" },
      });

      expect(res.statusCode).toBe(404);
      expect(await prisma.workspaceMember.findUnique({ where: { id: otherMember.id } })).toMatchObject({
        role: "member",
        status: "active",
      });
    });
  });

  describe("/channels/:channelId/workspace (WorkspaceChannelController)", () => {
    it.each([...MEMBERS, ...NON_MEMBERS])("GET workspace, members and knowledge list as %s", async (actor) => {
      const { channel, as } = await setup();
      const base = `/channels/${channel.id}/workspace`;

      const statuses = await Promise.all(
        [base, `${base}/members`, `${base}/knowledge`].map(async (url) =>
          (await app.inject({ method: "GET", url, headers: as(actor) })).statusCode,
        ),
      );

      const expected = MEMBERS.includes(actor) ? 200 : 403;
      expect(statuses).toEqual([expected, expected, expected]);
    });

    it("another user's channel without a workspace: 403 for them, 200 { exists: false } for the channel owner", async () => {
      const { as, users } = await setup();
      const bare = await prisma.channel.create({ data: { userId: users.outsider.id, name: "Solo" } });

      const stranger = await app.inject({ method: "GET", url: `/channels/${bare.id}/workspace`, headers: as("owner") });
      const own = await app.inject({ method: "GET", url: `/channels/${bare.id}/workspace`, headers: as("outsider") });

      expect(stranger.statusCode).toBe(403);
      expect(own.statusCode).toBe(200);
      expect(own.json()).toMatchObject({ exists: false });
    });

    it("only the channel owner can create its workspace (403 for others)", async () => {
      const { as, users } = await setup();
      const bare = await prisma.channel.create({ data: { userId: users.outsider.id, name: "Solo" } });

      const res = await app.inject({ method: "POST", url: `/channels/${bare.id}/workspace`, headers: as("owner") });

      expect(res.statusCode).toBe(403);
      expect(await prisma.workspace.count({ where: { channelId: bare.id } })).toBe(0);
    });

    // RX-113 (D63): only the owner adds a knowledge base (was owner, admin)
    it.each([...MEMBERS, ...NON_MEMBERS])("POST knowledge (create base) as %s (owner only)", async (actor) => {
      const { channel, as } = await setup();

      const res = await app.inject({
        method: "POST",
        url: `/channels/${channel.id}/workspace/knowledge`,
        headers: as(actor),
        payload: { name: `by ${actor}` },
      });

      expect(res.statusCode).toBe(expectFor({ owner: 201 }, actor));
      expect(await prisma.knowledgeBase.count()).toBe(res.statusCode === 201 ? 1 : 0);
    });

    // RNX-260: an admin or viewer row is a collaborator (member), so every active member adds chunks (RNX-218 makes it
    // owner-only later); the viewer was 403 before.
    it.each([...MEMBERS, ...NON_MEMBERS])("POST knowledge chunks as %s (every active member)", async (actor) => {
      const { channel, workspace, as, users } = await setup();
      const kb = await prisma.knowledgeBase.create({
        data: { workspaceId: workspace.id, userId: users.owner.id, name: "Team KB" },
      });

      const res = await app.inject({
        method: "POST",
        url: `/channels/${channel.id}/workspace/knowledge/${kb.id}/chunks`,
        headers: as(actor),
        payload: { chunks: [{ content: `from ${actor}` }] },
      });

      const expected = expectFor({ owner: 201, admin: 201, member: 201, viewer: 201 }, actor);
      expect(res.statusCode).toBe(expected);
      expect(await prisma.knowledgeChunk.count({ where: { knowledgeBaseId: kb.id } })).toBe(expected === 201 ? 1 : 0);
    });

    it.each([...MEMBERS, ...NON_MEMBERS])("DELETE a knowledge base as %s (owner only; RNX-260: an admin row is 403)", async (actor) => {
      const { channel, workspace, as, users } = await setup();
      const kb = await prisma.knowledgeBase.create({
        data: { workspaceId: workspace.id, userId: users.owner.id, name: "Team KB" },
      });

      const res = await app.inject({
        method: "DELETE",
        url: `/channels/${channel.id}/workspace/knowledge/${kb.id}`,
        headers: as(actor),
      });

      const expected = expectFor({ owner: 200 }, actor);
      expect(res.statusCode).toBe(expected);
      expect(await prisma.knowledgeBase.count({ where: { id: kb.id } })).toBe(expected === 200 ? 0 : 1);
    });

    it("a base of another workspace cannot be read or deleted through this workspace (404)", async () => {
      const { channel, as, users } = await setup();
      const other = await createWorkspace(prisma, { ownerId: users.outsider.id });
      const foreignKb = await prisma.knowledgeBase.create({
        data: { workspaceId: other.id, userId: users.outsider.id, name: "Other KB" },
      });

      const chunks = await app.inject({
        method: "GET",
        url: `/channels/${channel.id}/workspace/knowledge/${foreignKb.id}/chunks`,
        headers: as("owner"),
      });
      const del = await app.inject({
        method: "DELETE",
        url: `/channels/${channel.id}/workspace/knowledge/${foreignKb.id}`,
        headers: as("owner"),
      });

      expect([chunks.statusCode, del.statusCode]).toEqual([404, 404]);
      expect(await prisma.knowledgeBase.count({ where: { id: foreignKb.id } })).toBe(1);
    });

    it.each([...MEMBERS, ...NON_MEMBERS])("PATCH a member (the viewer) through the channel as %s (owner only; RNX-260: an admin row is 403)", async (actor) => {
      const { channel, memberIds, as } = await setup();

      const res = await app.inject({
        method: "PATCH",
        url: `/channels/${channel.id}/workspace/members/${memberIds.viewer}`,
        headers: as(actor),
        payload: { role: "member" },
      });

      expect(res.statusCode).toBe(expectFor({ owner: 200 }, actor));
    });
  });
});
