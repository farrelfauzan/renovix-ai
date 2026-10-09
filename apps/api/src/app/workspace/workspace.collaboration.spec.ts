import { createHash, randomBytes } from "node:crypto";
import { TestingModule } from "@nestjs/testing";
import { NestFastifyApplication } from "@nestjs/platform-fastify";
import * as jwt from "jsonwebtoken";
import { WorkspaceController } from "./workspace.controller";
import { WorkspaceInviteController } from "./workspace-invite.controller";
import { WorkspaceChannelController } from "./workspace-channel.controller";
import { WorkspaceService } from "./workspace.service";
import { WorkspaceMemberService } from "./workspace-member.service";
import { WorkspaceInviteService } from "./workspace-invite.service";
import { WorkspaceQuotaService } from "./workspace-quota.service";
import { WorkspaceKnowledgeService } from "./workspace-knowledge.service";
import { EmailJobService } from "../email/email-job.service";
import { EmbeddingService } from "../knowledge/embedding.service";
import { S3Service } from "../knowledge/s3.service";
import { PrismaService } from "../prisma/prisma.service";
import { createFastifyApp, createTestModule } from "../../../test/test-module";
import { resetDatabase } from "../../../test/test-database";
import { createPlan, createSubscription, createUser, createWorkspace } from "../../../test/factories";

// RX-113 (D64, extends D44): only Enterprise collaborates. On Starter, Pro or
// without an active subscription a workspace is owner-only: invites (create,
// resend, accept) and adding a member are 403, and every workspace route a
// non-owner reaches is 403, while the owner keeps using their own workspace.
// Enterprise keeps invites, members and the seat limit (maxWorkspaceUsers).
// The one check is WorkspaceQuotaService.isCollaborationAllowed. Real
// controllers and services on the test database; email is a recording fake.
jest.mock("../../lib/auth", () => ({ auth: { api: { getSession: async () => null } } }));
jest.mock("../email/email-job.service", () => ({ EmailJobService: class {} }));
jest.mock("../knowledge/embedding.service", () => ({ EmbeddingService: class {} }));
jest.mock("../knowledge/s3.service", () => ({ S3Service: class {} }));

process.env.JWT_SECRET = "rx113-test-jwt-secret";

const hash = (token: string) => createHash("sha256").update(token).digest("hex");

// Owner plans that do not allow collaboration: the seeded slugs and seat
// counts (Starter 3, Pro 10), no subscription, and a lapsed Enterprise one.
type OwnerPlan = { slug: string; maxWorkspaceUsers: number; status?: string } | null;
const NOT_ENTERPRISE: [string, OwnerPlan][] = [
  ["Starter", { slug: "starter", maxWorkspaceUsers: 3 }],
  ["Pro", { slug: "pro", maxWorkspaceUsers: 10 }],
  ["no subscription", null],
  ["a canceled Enterprise subscription", { slug: "enterprise", maxWorkspaceUsers: 100, status: "canceled" }],
];

describe("Workspace collaboration is Enterprise only (RX-113, Fastify, test database)", () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let app: NestFastifyApplication;
  const email = { enqueue: jest.fn(async () => undefined) };
  const zero = () => ({ embedding: new Array(1024).fill(0), tokenCount: 1 });

  beforeAll(async () => {
    ({ moduleRef, prisma } = await createTestModule({
      controllers: [WorkspaceController, WorkspaceInviteController, WorkspaceChannelController],
      providers: [
        WorkspaceService,
        WorkspaceMemberService,
        WorkspaceInviteService,
        WorkspaceQuotaService,
        WorkspaceKnowledgeService,
        { provide: EmailJobService, useValue: email },
        {
          provide: EmbeddingService,
          useValue: { embed: async (texts: string[]) => texts.map(zero), embedSingle: async () => zero() },
        },
        { provide: S3Service, useValue: {} },
      ],
    }));
    app = await createFastifyApp(moduleRef);
  });

  beforeEach(async () => {
    await resetDatabase(prisma);
    email.enqueue.mockClear();
  });

  afterAll(() => app?.close());

  const auth = (user: { id: string; email: string }) => ({
    authorization: `Bearer ${jwt.sign({ userId: user.id, email: user.email }, process.env.JWT_SECRET!)}`,
  });

  // A workspace (on the owner's channel) whose owner has `plan`, with an
  // admin and a member row inserted directly, a removed member, a pending
  // invite for `invitee`, and a workspace knowledge base.
  const setup = async (plan: OwnerPlan) => {
    const owner = await createUser(prisma);
    const admin = await createUser(prisma);
    const member = await createUser(prisma);
    const removed = await createUser(prisma);
    const invitee = await createUser(prisma);
    if (plan) {
      const p = await createPlan(prisma, { slug: plan.slug, maxWorkspaceUsers: plan.maxWorkspaceUsers });
      await createSubscription(prisma, { userId: owner.id, planId: p.id, status: plan.status ?? "active" });
    }
    const channel = await prisma.channel.create({ data: { userId: owner.id, name: "Team" } });
    const workspace = await createWorkspace(prisma, { ownerId: owner.id, channelId: channel.id });
    const row = (userId: string, role: string, status = "active") =>
      prisma.workspaceMember.create({ data: { workspaceId: workspace.id, userId, role, status, joinedAt: new Date() } });
    await row(owner.id, "owner");
    await row(admin.id, "admin");
    await row(member.id, "member");
    const removedRow = await row(removed.id, "member", "removed");
    const token = randomBytes(32).toString("hex");
    const invite = await prisma.workspaceInvite.create({
      data: {
        workspaceId: workspace.id,
        email: invitee.email,
        emailNormalized: invitee.email,
        tokenHash: hash(token),
        role: "member",
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
        invitedById: owner.id,
      },
    });
    const kb = await prisma.knowledgeBase.create({
      data: { userId: owner.id, workspaceId: workspace.id, name: "Team KB" },
    });
    return { owner, admin, member, removed, removedRow, invitee, channel, workspace, invite, token, kb };
  };
  type Ctx = Awaited<ReturnType<typeof setup>>;

  const state = async (c: Ctx) => ({
    members: await prisma.workspaceMember.findMany({
      where: { workspaceId: c.workspace.id },
      select: { userId: true, role: true, status: true },
      orderBy: { userId: "asc" },
    }),
    invites: await prisma.workspaceInvite.findMany({
      where: { workspaceId: c.workspace.id },
      select: { id: true, status: true, tokenHash: true },
      orderBy: { id: "asc" },
    }),
  });

  describe.each(NOT_ENTERPRISE)("owner on %s", (_label, plan) => {
    describe("AC4: inviting and adding members is 403, nothing changes", () => {
      const cases: [string, (c: Ctx) => Promise<{ statusCode: number }>][] = [
        ["owner creates an invite (POST /workspaces/:id/invites)", (c) =>
          app.inject({ method: "POST", url: `/workspaces/${c.workspace.id}/invites`, headers: auth(c.owner), payload: { email: "new@test.local" } })],
        ["owner creates an invite (POST /channels/:channelId/workspace/invites)", (c) =>
          app.inject({ method: "POST", url: `/channels/${c.channel.id}/workspace/invites`, headers: auth(c.owner), payload: { email: "new@test.local" } })],
        ["owner resends an invite (/workspaces)", (c) =>
          app.inject({ method: "POST", url: `/workspaces/${c.workspace.id}/invites/${c.invite.id}/resend`, headers: auth(c.owner) })],
        ["owner resends an invite (/channels)", (c) =>
          app.inject({ method: "POST", url: `/channels/${c.channel.id}/workspace/invites/${c.invite.id}/resend`, headers: auth(c.owner) })],
        ["the invitee accepts an existing invite", (c) =>
          app.inject({ method: "POST", url: "/workspace-invites/accept", headers: auth(c.invitee), payload: { token: c.token } })],
        ["owner reactivates a removed member (/workspaces)", (c) =>
          app.inject({ method: "PATCH", url: `/workspaces/${c.workspace.id}/members/${c.removedRow.id}`, headers: auth(c.owner), payload: { status: "active" } })],
        ["owner reactivates a removed member (/channels)", (c) =>
          app.inject({ method: "PATCH", url: `/channels/${c.channel.id}/workspace/members/${c.removedRow.id}`, headers: auth(c.owner), payload: { status: "active" } })],
      ];

      it.each(cases)("%s → 403", async (_name, call) => {
        const ctx = await setup(plan);
        const before = await state(ctx);

        const res = await call(ctx);

        expect(res.statusCode).toBe(403);
        expect(await state(ctx)).toEqual(before);
        expect(email.enqueue).not.toHaveBeenCalled();
      });
    });

    describe("AC5: a non-owner with a member row is refused on every workspace route; the owner is not", () => {
      // every row has a payload slot: a shorter row would make Jest pass `done` as the 4th argument
      const routes: [string, "GET" | "POST" | "PATCH", (c: Ctx) => string, unknown][] = [
        ["GET /workspaces/:id", "GET", (c) => `/workspaces/${c.workspace.id}`, undefined],
        ["PATCH /workspaces/:id", "PATCH", (c) => `/workspaces/${c.workspace.id}`, { description: "changed" }],
        ["GET /workspaces/:id/members", "GET", (c) => `/workspaces/${c.workspace.id}/members`, undefined],
        ["GET /workspaces/:id/quota", "GET", (c) => `/workspaces/${c.workspace.id}/quota`, undefined],
        ["GET /workspaces/:id/invites", "GET", (c) => `/workspaces/${c.workspace.id}/invites`, undefined],
        ["GET /channels/:channelId/workspace", "GET", (c) => `/channels/${c.channel.id}/workspace`, undefined],
        ["GET /channels/:channelId/workspace/members", "GET", (c) => `/channels/${c.channel.id}/workspace/members`, undefined],
        ["GET /channels/:channelId/workspace/invites", "GET", (c) => `/channels/${c.channel.id}/workspace/invites`, undefined],
        ["GET /channels/:channelId/workspace/quota", "GET", (c) => `/channels/${c.channel.id}/workspace/quota`, undefined],
        ["GET /channels/:channelId/workspace/knowledge", "GET", (c) => `/channels/${c.channel.id}/workspace/knowledge`, undefined],
        ["GET .../knowledge/:kbId/chunks", "GET", (c) => `/channels/${c.channel.id}/workspace/knowledge/${c.kb.id}/chunks`, undefined],
        ["POST .../knowledge/:kbId/chunks", "POST", (c) => `/channels/${c.channel.id}/workspace/knowledge/${c.kb.id}/chunks`, { chunks: [{ content: "x" }] }],
        ["POST .../knowledge/search", "POST", (c) => `/channels/${c.channel.id}/workspace/knowledge/search`, { query: "x" }],
      ];

      it.each(routes)("%s → 403 for the admin and the member", async (_name, method, url, payload) => {
        const ctx = await setup(plan);
        const before = await state(ctx);

        const statuses = [];
        for (const actor of [ctx.admin, ctx.member]) {
          statuses.push((await app.inject({ method, url: url(ctx), headers: auth(actor), payload: payload as object })).statusCode);
        }

        expect(statuses).toEqual([403, 403]);
        expect(await state(ctx)).toEqual(before);
        expect(await prisma.knowledgeChunk.count()).toBe(0);
        expect(await prisma.workspace.findUnique({ where: { id: ctx.workspace.id } })).toMatchObject({ description: null });
      });

      it.each(routes)("%s → 2xx for the owner", async (_name, method, url, payload) => {
        const ctx = await setup(plan);

        const res = await app.inject({ method, url: url(ctx), headers: auth(ctx.owner), payload: payload as object });

        expect(res.statusCode).toBe(method === "POST" && url(ctx).endsWith("/chunks") ? 201 : 200);
      });

      // The owner is recognised by workspace.ownerId, never by a member row's
      // role: a non-owner whose row says "owner" is still refused. Members list
      // goes only through requireMembership, GET workspace through getById,
      // the channel route through resolveWorkspace.
      it("a non-owner whose member row has role \"owner\" → 403 on members, workspace and channel routes; the real owner → 200", async () => {
        const ctx = await setup(plan);
        const fakeOwner = await createUser(prisma);
        await prisma.workspaceMember.create({
          data: { workspaceId: ctx.workspace.id, userId: fakeOwner.id, role: "owner", status: "active", joinedAt: new Date() },
        });
        const urls = [
          `/workspaces/${ctx.workspace.id}/members`,
          `/workspaces/${ctx.workspace.id}`,
          `/channels/${ctx.channel.id}/workspace`,
        ];

        const fake = [];
        const real = [];
        for (const url of urls) {
          fake.push((await app.inject({ method: "GET", url, headers: auth(fakeOwner) })).statusCode);
          real.push((await app.inject({ method: "GET", url, headers: auth(ctx.owner) })).statusCode);
        }

        expect(fake).toEqual([403, 403, 403]);
        expect(real).toEqual([200, 200, 200]);
      });
    });
  });

  describe("AC6: Enterprise works as before", () => {
    const enterprise = (maxWorkspaceUsers = 100): OwnerPlan => ({ slug: "enterprise", maxWorkspaceUsers });

    it("owner creates and resends an invite; the invitee accepts and becomes a member", async () => {
      const ctx = await setup(enterprise());

      const create = await app.inject({
        method: "POST",
        url: `/workspaces/${ctx.workspace.id}/invites`,
        headers: auth(ctx.owner),
        payload: { email: "New@Test.local" },
      });
      const resend = await app.inject({
        method: "POST",
        url: `/channels/${ctx.channel.id}/workspace/invites/${ctx.invite.id}/resend`,
        headers: auth(ctx.owner),
      });
      const resent = await prisma.workspaceInvite.findUniqueOrThrow({ where: { id: ctx.invite.id } });
      // resend replaces the token, so take the new one from the queued email
      const newToken = (email.enqueue.mock.calls[1] as unknown as [{ payload: { token: string } }])[0].payload.token;
      const accept = await app.inject({
        method: "POST",
        url: "/workspace-invites/accept",
        headers: auth(ctx.invitee),
        payload: { token: newToken },
      });

      expect([create.statusCode, resend.statusCode, accept.statusCode]).toEqual([201, 200, 200]);
      expect(resent.tokenHash).toBe(hash(newToken));
      expect(await prisma.workspaceInvite.count({ where: { workspaceId: ctx.workspace.id, emailNormalized: "new@test.local", status: "pending" } })).toBe(1);
      expect(email.enqueue).toHaveBeenCalledTimes(2);
      expect(
        await prisma.workspaceMember.findUnique({
          where: { workspaceId_userId: { workspaceId: ctx.workspace.id, userId: ctx.invitee.id } },
        }),
      ).toMatchObject({ role: "member", status: "active" });
    });

    it("an admin and a member (non-owners) use the workspace routes (200)", async () => {
      const ctx = await setup(enterprise());

      const statuses = [];
      for (const actor of [ctx.admin, ctx.member]) {
        for (const url of [`/workspaces/${ctx.workspace.id}/members`, `/channels/${ctx.channel.id}/workspace/knowledge`, `/workspaces/${ctx.workspace.id}/quota`]) {
          statuses.push((await app.inject({ method: "GET", url, headers: auth(actor) })).statusCode);
        }
      }
      const invites = await app.inject({ method: "GET", url: `/workspaces/${ctx.workspace.id}/invites`, headers: auth(ctx.admin) });

      expect(statuses).toEqual([200, 200, 200, 200, 200, 200]);
      expect(invites.statusCode).toBe(200);
    });

    it("the owner reactivates a removed member (200)", async () => {
      const ctx = await setup(enterprise());

      const res = await app.inject({
        method: "PATCH",
        url: `/workspaces/${ctx.workspace.id}/members/${ctx.removedRow.id}`,
        headers: auth(ctx.owner),
        payload: { status: "active" },
      });

      expect(res.statusCode).toBe(200);
      expect(await prisma.workspaceMember.findUnique({ where: { id: ctx.removedRow.id } })).toMatchObject({ status: "active" });
    });

    it("the seat limit still applies: with every seat taken, a new invite and an accept are refused (400)", async () => {
      // 3 seats: owner, admin and member are active
      const ctx = await setup(enterprise(3));
      const before = await state(ctx);

      const create = await app.inject({
        method: "POST",
        url: `/workspaces/${ctx.workspace.id}/invites`,
        headers: auth(ctx.owner),
        payload: { email: "new@test.local" },
      });
      const accept = await app.inject({
        method: "POST",
        url: "/workspace-invites/accept",
        headers: auth(ctx.invitee),
        payload: { token: ctx.token },
      });

      expect([create.statusCode, accept.statusCode]).toEqual([400, 400]);
      expect(accept.json().message).toContain("seat limit (3)");
      expect(await state(ctx)).toEqual(before);
    });
  });
});
