import { ConfigService } from "@nestjs/config";
import { TestingModule } from "@nestjs/testing";
import { NestFastifyApplication } from "@nestjs/platform-fastify";
import { WorkspaceController } from "./workspace.controller";
import { WorkspaceInviteController } from "./workspace-invite.controller";
import { WorkspaceChannelController } from "./workspace-channel.controller";
import { WorkspaceService } from "../service/workspace.service";
import { WorkspaceMemberService } from "../service/workspace-member.service";
import { WorkspaceInviteService } from "../service/workspace-invite.service";
import { WorkspaceQuotaService } from "../service/workspace-quota.service";
import { WorkspaceKnowledgeService } from "../service/workspace-knowledge.service";
import { McpUserController } from "../../mcp/controller/mcp-user.controller";
import { WebSearchController } from "../../mcp/controller/web-search.controller";
import { McpUserService } from "../../mcp/service/mcp-user.service";
import { WebSearchService } from "../../mcp/service/web-search.service";
import { McpOAuthStateRepository } from "../../mcp/repository/mcp-oauth-state.repository";
import { EmailJobService } from "../../email/service/email-job.service";
import { EmbeddingService } from "../../knowledge/service/embedding.service";
import { S3Service } from "../../knowledge/service/s3.service";
import { PrismaService } from "../../prisma/prisma.service";
import { hashToken } from "../utils/hash-token";
import { createFastifyApp, createTestModule } from "../../../../test/test-module";
import { resetDatabase } from "../../../../test/test-database";
import { createAgent, createPackageSnapshot, createUser, createWorkspace } from "../../../../test/factories";
import { asSessionUser } from "../../../../test/as-session-user";

// RNX-125: DELETE /workspaces/:id (owner only) sets the workspace's deletedAt and deletedById; the row and its children
// (members, invites, memories, knowledge bases and chunks, agents, MCP credentials and OAuth states, its channel) stay.
// A deleted workspace is gone for everyone, its owner included: GET /workspaces leaves it out, every route that takes
// its id (the workspace routes, its channel's workspace routes with its knowledge bases, the MCP and web search routes)
// answers 404 "Workspace not found" and changes nothing, its pending invite cannot be read or accepted (404), and its
// MCP OAuth flow is never used. Clearing the marker in the database brings it all back. Real controllers and services,
// test database; email sending, embeddings and S3 are stubs. `all` is a client with nothing on PrismaService's default
// filter map, to read the rows as they are.
jest.mock("../../email/service/email-job.service", () => ({ EmailJobService: class {} }));
jest.mock("../../knowledge/service/embedding.service", () => ({ EmbeddingService: class {} }));
jest.mock("../../knowledge/service/s3.service", () => ({ S3Service: class {} }));

const STATE_SECRET = "rnx125-state-secret-not-a-real-secret";
const CONFIG = {
  GOOGLE_OAUTH_CLIENT_ID: "rnx125-google-client-id",
  GOOGLE_OAUTH_CLIENT_SECRET: "rnx125-google-client-secret-not-a-real-secret",
  GOOGLE_OAUTH_REDIRECT_URI: "http://api.test.local/mcp/user/oauth/callback",
  CHAT_APP_URL: "http://chat.test.local",
};
const CAROL_TOKEN = "rnx125-carol-invite-token";

type Seeded = Awaited<ReturnType<typeof seedWorkspace>>;
type Route = { method: "GET" | "POST" | "PATCH" | "PUT" | "DELETE"; url: string; payload?: object };

/** Every route that takes the workspace's id (or its channel's), destructive ones last. */
const routesOf = (s: Seeded): Record<string, Route> => {
  const w = s.workspace.id;
  const c = s.channel.id;
  return {
    "GET /workspaces/:id": { method: "GET", url: `/workspaces/${w}` },
    "PATCH /workspaces/:id": { method: "PATCH", url: `/workspaces/${w}`, payload: { name: "Renamed" } },
    "GET /workspaces/:id/quota": { method: "GET", url: `/workspaces/${w}/quota` },
    "GET /workspaces/:id/members": { method: "GET", url: `/workspaces/${w}/members` },
    "PATCH /workspaces/:id/members/:memberId": { method: "PATCH", url: `/workspaces/${w}/members/${s.bobMember.id}`, payload: { role: "member" } },
    "GET /workspaces/:id/invites": { method: "GET", url: `/workspaces/${w}/invites` },
    "POST /workspaces/:id/invites": { method: "POST", url: `/workspaces/${w}/invites`, payload: { email: "erin@test.local" } },
    "POST /workspaces/:id/invites/:inviteId/resend": { method: "POST", url: `/workspaces/${w}/invites/${s.invite.id}/resend` },
    "GET /channels/:channelId/workspace": { method: "GET", url: `/channels/${c}/workspace` },
    "POST /channels/:channelId/workspace": { method: "POST", url: `/channels/${c}/workspace` },
    "GET /channels/:channelId/workspace/members": { method: "GET", url: `/channels/${c}/workspace/members` },
    "PATCH /channels/:channelId/workspace/members/:memberId": { method: "PATCH", url: `/channels/${c}/workspace/members/${s.bobMember.id}`, payload: { role: "member" } },
    "GET /channels/:channelId/workspace/invites": { method: "GET", url: `/channels/${c}/workspace/invites` },
    "POST /channels/:channelId/workspace/invites": { method: "POST", url: `/channels/${c}/workspace/invites`, payload: { email: "frank@test.local" } },
    "POST /channels/:channelId/workspace/invites/:inviteId/resend": { method: "POST", url: `/channels/${c}/workspace/invites/${s.invite.id}/resend` },
    "GET /channels/:channelId/workspace/quota": { method: "GET", url: `/channels/${c}/workspace/quota` },
    "GET /channels/:channelId/workspace/knowledge": { method: "GET", url: `/channels/${c}/workspace/knowledge` },
    "POST /channels/:channelId/workspace/knowledge": { method: "POST", url: `/channels/${c}/workspace/knowledge`, payload: { name: "New KB" } },
    "GET /channels/:channelId/workspace/knowledge/:kbId/chunks": { method: "GET", url: `/channels/${c}/workspace/knowledge/${s.kb.id}/chunks` },
    "POST /channels/:channelId/workspace/knowledge/:kbId/chunks": { method: "POST", url: `/channels/${c}/workspace/knowledge/${s.kb.id}/chunks`, payload: { chunks: [{ content: "more" }] } },
    "POST /channels/:channelId/workspace/knowledge/search": { method: "POST", url: `/channels/${c}/workspace/knowledge/search`, payload: { query: "secret" } },
    "GET /mcp/user/credentials": { method: "GET", url: `/mcp/user/credentials?workspaceId=${w}` },
    "GET /mcp/user/oauth/start": { method: "GET", url: `/mcp/user/oauth/start?provider=google-gmail&workspaceId=${w}` },
    "POST /mcp/user/connect": { method: "POST", url: "/mcp/user/connect", payload: { provider: "notion", workspaceId: w, env: { NOTION_TOKEN: "t" } } },
    "GET /integrations/web-search/status": { method: "GET", url: `/integrations/web-search/status?workspaceId=${w}` },
    "GET /integrations/web-search/policy": { method: "GET", url: `/integrations/web-search/policy?workspaceId=${w}` },
    "PUT /integrations/web-search/policy": { method: "PUT", url: "/integrations/web-search/policy", payload: { workspaceId: w, maxResults: 3 } },
    "PUT /integrations/web-search/brave/key": { method: "PUT", url: "/integrations/web-search/brave/key", payload: { workspaceId: w, apiKey: "k" } },
    "PUT /integrations/web-search/providers/:provider/key": { method: "PUT", url: "/integrations/web-search/providers/brave-search/key", payload: { workspaceId: w, apiKey: "k" } },
    "DELETE /integrations/web-search/brave/key": { method: "DELETE", url: `/integrations/web-search/brave/key?workspaceId=${w}` },
    "DELETE /mcp/user/credentials/:provider": { method: "DELETE", url: `/mcp/user/credentials/github?workspaceId=${w}` },
    "PUT /mcp/user/credentials/:provider/workspaces/:workspaceId": { method: "PUT", url: `/mcp/user/credentials/github/workspaces/${w}` },
    "DELETE /channels/:channelId/workspace/knowledge/:kbId/chunks/:chunkId": { method: "DELETE", url: `/channels/${c}/workspace/knowledge/${s.kb.id}/chunks/${s.chunk.id}` },
    "DELETE /channels/:channelId/workspace/knowledge/:kbId": { method: "DELETE", url: `/channels/${c}/workspace/knowledge/${s.kb.id}` },
    "POST /channels/:channelId/workspace/invites/:inviteId/revoke": { method: "POST", url: `/channels/${c}/workspace/invites/${s.invite.id}/revoke` },
    "POST /workspaces/:id/invites/:inviteId/revoke": { method: "POST", url: `/workspaces/${w}/invites/${s.invite.id}/revoke` },
    "DELETE /channels/:channelId/workspace/members/:memberId": { method: "DELETE", url: `/channels/${c}/workspace/members/${s.bobMember.id}` },
    "DELETE /workspaces/:id/members/:memberId": { method: "DELETE", url: `/workspaces/${w}/members/${s.bobMember.id}` },
    "DELETE /workspaces/:id": { method: "DELETE", url: `/workspaces/${w}` },
  };
};

/** An Enterprise owner's workspace with its channel and every kind of child row; Bob a member, Carol invited. */
async function seedWorkspace(prisma: PrismaService) {
  const owner = await createUser(prisma);
  const bob = await createUser(prisma);
  const carol = await createUser(prisma);
  await createPackageSnapshot(prisma, { userId: owner.id, collaborationEnabled: true });
  const channel = await prisma.channel.create({ data: { userId: owner.id, name: "Team" } });
  const workspace = await createWorkspace(prisma, { ownerId: owner.id, name: "Team", channelId: channel.id });
  await prisma.workspaceMember.create({ data: { workspaceId: workspace.id, userId: owner.id, role: "owner" } });
  const bobMember = await prisma.workspaceMember.create({ data: { workspaceId: workspace.id, userId: bob.id, role: "member" } });
  const invite = await prisma.workspaceInvite.create({
    data: {
      workspaceId: workspace.id,
      email: carol.email,
      emailNormalized: carol.email,
      tokenHash: hashToken(CAROL_TOKEN),
      expiresAt: new Date(Date.now() + 86_400_000),
      invitedById: owner.id,
    },
  });
  const kb = await prisma.knowledgeBase.create({ data: { userId: owner.id, workspaceId: workspace.id, name: "Team KB" } });
  const chunk = await prisma.knowledgeChunk.create({
    data: { knowledgeBaseId: kb.id, content: "team secret", tokenCount: 2, embeddingModel: "test-model", embeddedAt: new Date() },
  });
  await prisma.workspaceMemory.create({ data: { workspaceId: workspace.id, type: "fact", content: "team fact" } });
  const agent = await createAgent(prisma, { userId: owner.id, workspaceId: workspace.id });
  // RNX-292: the credential is the owner's account credential (not switched on here; workspace-mcp-connections.spec.ts covers the switches).
  await prisma.userMcpCredential.create({ data: { userId: owner.id, provider: "github", envEncrypted: "sealed" } });
  await prisma.mcpOAuthState.create({
    data: { nonce: `n-${workspace.id}`, userId: owner.id, workspaceId: workspace.id, provider: "google-gmail", expiresAt: new Date(Date.now() + 600_000) },
  });
  return { owner, bob, carol, channel, workspace, bobMember, invite, kb, chunk, agent };
}

describe("RNX-125: a deleted workspace is gone for everyone, its children stay hidden with it (Fastify, test database)", () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let all: PrismaService;
  let app: NestFastifyApplication;
  const emailJobs = { enqueue: jest.fn(async () => undefined) };
  const ones = () => ({ embedding: new Array(1024).fill(1), tokenCount: 1 });
  const embedding = {
    modelName: "test-model",
    embed: jest.fn(async (texts: string[]) => texts.map(ones)),
    embedSingle: jest.fn(async () => ones()),
  };

  beforeAll(async () => {
    ({ moduleRef, prisma } = await createTestModule({
      controllers: [WorkspaceController, WorkspaceInviteController, WorkspaceChannelController, McpUserController, WebSearchController],
      providers: [
        WorkspaceService,
        WorkspaceMemberService,
        WorkspaceInviteService,
        WorkspaceQuotaService,
        WorkspaceKnowledgeService,
        McpUserService,
        WebSearchService,
        { provide: EmailJobService, useValue: emailJobs },
        { provide: EmbeddingService, useValue: embedding },
        { provide: S3Service, useValue: {} },
        { provide: ConfigService, useValue: new ConfigService(CONFIG) },
      ],
    }));
    app = await createFastifyApp(moduleRef);
    all = PrismaService.create({});
  });

  beforeEach(async () => {
    process.env.MCP_OAUTH_STATE_SECRET = STATE_SECRET;
    await resetDatabase(prisma);
    emailJobs.enqueue.mockClear();
    embedding.embedSingle.mockClear();
  });

  afterAll(async () => {
    await app?.close();
    await all?.$disconnect();
  });

  /** Every row a workspace route could change, read as they are (deleted ones included). */
  const readRows = async () => ({
    workspaces: await all.workspace.findMany({ orderBy: { id: "asc" } }),
    members: await all.workspaceMember.findMany({ orderBy: { id: "asc" } }),
    invites: await all.workspaceInvite.findMany({ orderBy: { id: "asc" } }),
    memories: await all.workspaceMemory.findMany({ orderBy: { id: "asc" } }),
    knowledgeBases: await all.knowledgeBase.findMany({ orderBy: { id: "asc" } }),
    chunks: await all.knowledgeChunk.findMany({ orderBy: { id: "asc" }, select: { id: true, content: true } }),
    agents: await all.agent.findMany({ orderBy: { id: "asc" } }),
    credentials: await all.userMcpCredential.findMany({ orderBy: { id: "asc" } }),
    oauthStates: await all.mcpOAuthState.findMany({ orderBy: { nonce: "asc" } }),
    channels: await all.channel.findMany({ orderBy: { id: "asc" } }),
    appConfig: await all.appConfig.findMany({ orderBy: { key: "asc" } }),
  });

  const call = (route: Route, user: { id: string; email: string }) =>
    app.inject({ method: route.method, url: route.url, headers: asSessionUser(user), payload: route.payload });

  /** Each route's answer for this user: status and message. */
  const answersOf = async (s: Seeded, user: { id: string; email: string }) => {
    const answers: Record<string, [number, string | undefined]> = {};
    for (const [name, route] of Object.entries(routesOf(s))) {
      const res = await call(route, user);
      answers[name] = [res.statusCode, res.json().message];
    }
    return answers;
  };

  const listIds = async (user: { id: string; email: string }) =>
    (await app.inject({ method: "GET", url: "/workspaces", headers: asSessionUser(user) })).json().map((w: { id: string }) => w.id);

  const deleteWorkspace = (s: Seeded) => call({ method: "DELETE", url: `/workspaces/${s.workspace.id}` }, s.owner);

  it("RNX-125 AC6: the owner's DELETE answers 200 with the workspace as before; it gets deletedAt and deletedById, its status is unchanged and every child row stays", async () => {
    const s = await seedWorkspace(prisma);
    const before = await readRows();

    const res = await deleteWorkspace(s);

    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ id: s.workspace.id, name: "Team", ownerId: s.owner.id, slug: s.workspace.slug, channelId: s.channel.id });
    expect(Object.keys(res.json())).toEqual(expect.arrayContaining(Object.keys(s.workspace)));
    const after = await readRows();
    expect(after.workspaces).toEqual([
      { ...s.workspace, deletedAt: expect.any(Date), deletedById: s.owner.id, updatedAt: expect.any(Date) },
    ]);
    expect({ ...after, workspaces: [] }).toEqual({ ...before, workspaces: [] });
  });

  it("RNX-125 AC10: a member who is not the owner gets 403 as before and nothing changes; the default workspace answers 404 and is not deleted", async () => {
    const s = await seedWorkspace(prisma);
    const solo = await createAgent(prisma, { userId: s.owner.id });
    const before = await readRows();

    const byMember = await call({ method: "DELETE", url: `/workspaces/${s.workspace.id}` }, s.bob);
    const onDefault = await call({ method: "DELETE", url: `/workspaces/${solo.workspaceId}` }, s.owner);

    expect([byMember.statusCode, byMember.json().message]).toEqual([403, "Insufficient workspace permissions"]);
    expect([onDefault.statusCode, onDefault.json().message]).toEqual([404, "Workspace not found"]);
    expect(await readRows()).toEqual(before);
  });

  describe("RNX-125 AC7: after the delete", () => {
    it.each([
      ["the owner", (s: Seeded) => s.owner],
      ["a member", (s: Seeded) => s.bob],
      ["an invitee", (s: Seeded) => s.carol],
    ])("%s: GET /workspaces leaves it out and every route that takes its id answers 404 Workspace not found; nothing changes, no email", async (_who, pick) => {
      const s = await seedWorkspace(prisma);
      expect((await deleteWorkspace(s)).statusCode).toBe(200);
      const before = await readRows();
      const user = pick(s);

      const listed = await listIds(user);
      const answers = await answersOf(s, user);

      expect(listed).not.toContain(s.workspace.id);
      expect(answers).toEqual(Object.fromEntries(Object.keys(routesOf(s)).map((name) => [name, [404, "Workspace not found"]])));
      expect(await readRows()).toEqual(before);
      expect(emailJobs.enqueue).not.toHaveBeenCalled();
      expect(embedding.embedSingle).not.toHaveBeenCalled();
    });

    it("the invitee cannot read or accept the pending invite (404); the invite stays pending and no member row is added", async () => {
      const s = await seedWorkspace(prisma);
      await deleteWorkspace(s);
      const before = await readRows();

      const read = await app.inject({ method: "GET", url: `/workspace-invites/accept?token=${CAROL_TOKEN}` });
      const accept = await call({ method: "POST", url: "/workspace-invites/accept", payload: { token: CAROL_TOKEN } }, s.carol);

      expect([read.statusCode, accept.statusCode]).toEqual([404, 404]);
      expect(await readRows()).toEqual(before);
    });
  });

  describe("RNX-125 AC11: its MCP credentials and OAuth states stay, unused", () => {
    it("the OAuth callback of a flow started before the delete is refused; the state row stays, no credential is written", async () => {
      const s = await seedWorkspace(prisma);
      const start = await call({ method: "GET", url: `/mcp/user/oauth/start?provider=google-gmail&workspaceId=${s.workspace.id}` }, s.owner);
      expect(start.statusCode).toBe(200);
      const state = new URL(start.json().authUrl).searchParams.get("state") as string;
      const cookie = String(start.headers["set-cookie"]).split(";")[0];
      await deleteWorkspace(s);
      const before = await readRows();
      const fetchSpy = jest.spyOn(global, "fetch");

      const res = await app.inject({ method: "GET", url: `/mcp/user/oauth/callback?code=c&state=${encodeURIComponent(state)}`, headers: { cookie } });

      expect(res.statusCode).toBe(302);
      expect(res.headers.location).toContain("oauth=error");
      expect(fetchSpy).not.toHaveBeenCalled();
      expect(await readRows()).toEqual(before);
      expect(before.oauthStates).toHaveLength(2);
      fetchSpy.mockRestore();
    });

    it("the expired-flow cleanup leaves the deleted workspace's expired flow and removes a live workspace's", async () => {
      const s = await seedWorkspace(prisma);
      const live = await createWorkspace(prisma, { ownerId: s.owner.id });
      const past = new Date(Date.now() - 60_000);
      for (const workspaceId of [s.workspace.id, live.id]) {
        await prisma.mcpOAuthState.create({ data: { nonce: `old-${workspaceId}`, userId: s.owner.id, workspaceId, provider: "github", expiresAt: past } });
      }
      await deleteWorkspace(s);

      expect(await moduleRef.get(McpOAuthStateRepository).deleteExpired(new Date())).toBe(1);

      expect((await all.mcpOAuthState.findMany({ select: { nonce: true }, orderBy: { nonce: "asc" } })).map((r) => r.nonce)).toEqual(
        [`n-${s.workspace.id}`, `old-${s.workspace.id}`].sort(),
      );
      expect(await all.userMcpCredential.count({ where: { userId: s.owner.id } })).toBe(1);
    });
  });

  it("RNX-125 AC13: with deletedAt cleared in the database the workspace and everything under it is back: listed, routes answer, the invite can be accepted", async () => {
    const s = await seedWorkspace(prisma);
    await deleteWorkspace(s);
    await all.workspace.update({ where: { id: s.workspace.id }, data: { deletedAt: null, deletedById: null } });

    const listed = await listIds(s.owner);
    const accept = await call({ method: "POST", url: "/workspace-invites/accept", payload: { token: CAROL_TOKEN } }, s.carol);
    const listedForCarol = await listIds(s.carol);
    const answers = await answersOf(s, s.owner);

    expect(listed).toContain(s.workspace.id);
    expect(listedForCarol).toContain(s.workspace.id);
    // (the invite routes now find no pending invite: Carol accepted it above)
    expect(Object.entries(answers).filter(([, [, message]]) => message === "Workspace not found")).toEqual([]);
    expect(answers["GET /workspaces/:id"][0]).toBe(200);
    expect(answers["POST /channels/:channelId/workspace/knowledge/search"][0]).toBe(200);
    expect(answers["DELETE /workspaces/:id"][0]).toBe(200);
    expect(accept.statusCode).toBe(200);
  });
});
