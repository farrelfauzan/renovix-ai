import { TestingModule } from "@nestjs/testing";
import { NestFastifyApplication } from "@nestjs/platform-fastify";
import * as jwt from "jsonwebtoken";
import { WorkspaceController } from "./workspace.controller";
import { WorkspaceService } from "../service/workspace.service";
import { WorkspaceMemberService } from "../service/workspace-member.service";
import { WorkspaceInviteService } from "../service/workspace-invite.service";
import { WorkspaceQuotaService } from "../service/workspace-quota.service";
import { EmailJobService } from "../../email/service/email-job.service";
import { PrismaService } from "../../prisma/prisma.service";
import { createFastifyApp, createTestModule } from "../../../../test/test-module";
import { resetDatabase } from "../../../../test/test-database";
import { createAgent, createPlan, createSubscription, createUser, createWorkspace } from "../../../../test/factories";

// RNX-117 (D219, second decision, option a): the default workspace is hidden from the workspace routes.
// GET /workspaces leaves it out, and every /workspaces/:id route answers 404 "Workspace not found" for it and
// changes nothing (archive included: it cannot be archived, answer 3). The owner's normal workspace, set up the
// same way, works as before (control). The owner is on Enterprise so that member and invite routes are allowed
// (RX-113). Real controller and services, test database; email sending is a stub.
jest.mock("../../../lib/auth", () => ({ auth: { api: { getSession: async () => null } } }));
jest.mock("../../email/service/email-job.service", () => ({ EmailJobService: class {} }));

process.env.JWT_SECRET = "rnx117-hidden-test-jwt-secret";

type Ids = { workspaceId: string; memberId: string; inviteId: string };
type Route = { method: "GET" | "PATCH" | "DELETE" | "POST"; url: (ids: Ids) => string; payload?: object };

const ROUTES: [string, Route, number][] = [
  ["GET /workspaces/:id", { method: "GET", url: (i) => `/workspaces/${i.workspaceId}` }, 200],
  ["PATCH /workspaces/:id (rename)", { method: "PATCH", url: (i) => `/workspaces/${i.workspaceId}`, payload: { name: "Renamed" } }, 200],
  ["DELETE /workspaces/:id (archive)", { method: "DELETE", url: (i) => `/workspaces/${i.workspaceId}` }, 200],
  ["GET /workspaces/:id/quota", { method: "GET", url: (i) => `/workspaces/${i.workspaceId}/quota` }, 200],
  ["GET /workspaces/:id/members", { method: "GET", url: (i) => `/workspaces/${i.workspaceId}/members` }, 200],
  ["PATCH /workspaces/:id/members/:memberId (role change)", { method: "PATCH", url: (i) => `/workspaces/${i.workspaceId}/members/${i.memberId}`, payload: { role: "member" } }, 200],
  ["DELETE /workspaces/:id/members/:memberId (remove)", { method: "DELETE", url: (i) => `/workspaces/${i.workspaceId}/members/${i.memberId}` }, 200],
  ["GET /workspaces/:id/invites", { method: "GET", url: (i) => `/workspaces/${i.workspaceId}/invites` }, 200],
  ["POST /workspaces/:id/invites (invite)", { method: "POST", url: (i) => `/workspaces/${i.workspaceId}/invites`, payload: { email: "carol@test.local" } }, 201],
  ["POST /workspaces/:id/invites/:inviteId/resend", { method: "POST", url: (i) => `/workspaces/${i.workspaceId}/invites/${i.inviteId}/resend` }, 200],
  ["POST /workspaces/:id/invites/:inviteId/revoke", { method: "POST", url: (i) => `/workspaces/${i.workspaceId}/invites/${i.inviteId}/revoke` }, 200],
];

describe("RNX-117: the default workspace is hidden from the workspace routes (Fastify, test database)", () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let app: NestFastifyApplication;
  const emailJobs = { enqueue: jest.fn(async () => undefined) };

  beforeAll(async () => {
    ({ moduleRef, prisma } = await createTestModule({
      controllers: [WorkspaceController],
      providers: [
        WorkspaceService,
        WorkspaceMemberService,
        WorkspaceInviteService,
        WorkspaceQuotaService,
        { provide: EmailJobService, useValue: emailJobs },
      ],
    }));
    app = await createFastifyApp(moduleRef);
  });

  beforeEach(async () => {
    await resetDatabase(prisma);
    emailJobs.enqueue.mockClear();
  });

  afterAll(() => app?.close());

  const auth = (user: { id: string; email: string }) => ({
    authorization: `Bearer ${jwt.sign({ userId: user.id, email: user.email }, process.env.JWT_SECRET!)}`,
  });

  const readRows = () =>
    Promise.all([
      prisma.workspace.findMany({ orderBy: { id: "asc" } }),
      prisma.workspaceMember.findMany({ orderBy: { id: "asc" } }),
      prisma.workspaceInvite.findMany({ orderBy: { id: "asc" } }),
      prisma.agent.findMany({ orderBy: { id: "asc" } }),
    ]);

  /** Bob as a member and a pending invite in this workspace (rows written directly, as a past state). */
  const populate = async (workspaceId: string, ownerId: string, bobId: string): Promise<Ids> => {
    const member = await prisma.workspaceMember.create({ data: { workspaceId, userId: bobId, role: "member" } });
    const invite = await prisma.workspaceInvite.create({
      data: {
        workspaceId,
        email: "dave@test.local",
        emailNormalized: "dave@test.local",
        tokenHash: `token-${workspaceId}`,
        expiresAt: new Date(Date.now() + 86_400_000),
        invitedById: ownerId,
      },
    });
    return { workspaceId, memberId: member.id, inviteId: invite.id };
  };

  /** An Enterprise owner with an agent in the default workspace and a normal workspace, each with Bob and an invite. */
  const setup = async () => {
    const owner = await createUser(prisma);
    const bob = await createUser(prisma);
    const enterprise = await createPlan(prisma, { slug: "enterprise", maxWorkspaceUsers: 100 });
    await createSubscription(prisma, { userId: owner.id, planId: enterprise.id });
    const agent = await createAgent(prisma, { userId: owner.id });
    const normal = await createWorkspace(prisma, { ownerId: owner.id, name: "Team" });
    await prisma.workspaceMember.create({ data: { workspaceId: normal.id, userId: owner.id, role: "owner" } });
    return {
      owner,
      defaultIds: await populate(agent.workspaceId, owner.id, bob.id),
      normalIds: await populate(normal.id, owner.id, bob.id),
    };
  };

  it("GET /workspaces lists the normal workspace and leaves out the default one", async () => {
    const { owner, normalIds } = await setup();

    const res = await app.inject({ method: "GET", url: "/workspaces", headers: auth(owner) });

    expect(res.statusCode).toBe(200);
    expect(res.json().map((w: { id: string }) => w.id)).toEqual([normalIds.workspaceId]);
  });

  it.each(ROUTES)("%s on the default workspace: 404 Workspace not found, nothing changes", async (_name, route) => {
    const { owner, defaultIds } = await setup();
    const rowsBefore = await readRows();

    const res = await app.inject({ method: route.method, url: route.url(defaultIds), headers: auth(owner), payload: route.payload });

    expect({ status: res.statusCode, message: res.json().message }).toEqual({ status: 404, message: "Workspace not found" });
    expect(await readRows()).toEqual(rowsBefore);
    expect(emailJobs.enqueue).not.toHaveBeenCalled();
  });

  it.each(ROUTES)("control: %s on the owner's normal workspace works as before", async (_name, route, expected) => {
    const { owner, normalIds } = await setup();

    const res = await app.inject({ method: route.method, url: route.url(normalIds), headers: auth(owner), payload: route.payload });

    expect(res.statusCode).toBe(expected);
  });
});
