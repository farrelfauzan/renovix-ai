import { ConfigService } from "@nestjs/config";
import { TestingModule } from "@nestjs/testing";
import { NestFastifyApplication } from "@nestjs/platform-fastify";
import * as jwt from "jsonwebtoken";
import { McpUserController } from "./mcp-user.controller";
import { WebSearchController } from "./web-search.controller";
import { McpUserService } from "../service/mcp-user.service";
import { WebSearchService } from "../service/web-search.service";
import { WorkspaceService } from "../../workspace/service/workspace.service";
import { WorkspaceQuotaService } from "../../workspace/service/workspace-quota.service";
import { ensureDefaultWorkspace } from "../../workspace/repository/ensure-default-workspace";
import { PrismaService } from "../../prisma/prisma.service";
import { createFastifyApp, createTestModule } from "../../../../test/test-module";
import { resetDatabase } from "../../../../test/test-database";
import { createPlan, createSubscription, createUser, createWorkspace } from "../../../../test/factories";

// RNX-206: the four routes that take a workspace id and had no membership check (web search status, MCP
// connect, list and delete credentials) refuse exactly like GET /integrations/web-search/policy, through
// WorkspaceService.requireMembership: 403 for a non-member or a removed member, 403 under the collaboration
// rule (RX-113), 404 for a default workspace (RNX-117). A refused call reaches no service method, writes
// nothing and returns nothing but the error. Real McpUserService, WorkspaceService and test database;
// WebSearchService is a stub (its module loads ESM packages). Credentials here are fakes.
jest.mock("../../../lib/auth", () => ({ auth: { api: { getSession: async () => null } } }));
jest.mock("../service/web-search.service", () => ({ WebSearchService: class {} }));

const PROVIDER = "notion";
const NOT_A_MEMBER = "Not a member of this workspace";
const NO_COLLABORATION = "Workspace collaboration requires an Enterprise plan.";
const NOT_FOUND = "Workspace not found";

type Actor = { id: string; email: string };
type McpUserMethod = "connectWithToken" | "getUserCredentials" | "revokeCredential";
type Route = {
  method: "GET" | "POST" | "DELETE";
  url: (workspaceId: string) => string;
  payload?: (workspaceId: string) => object;
  /** The service method the route calls once allowed. */
  calls: { mcpUser: McpUserMethod } | { webSearch: "getUserWebSearchStatus" };
  /** Whether the actor already has a credential row in the workspace before the call. */
  hasCredential: boolean;
};

const webSearch = {
  getUserWebSearchStatus: jest.fn(async () => ({ connected: false, provider: "brave-search", policy: { maxResults: 5 } })),
  getPolicy: jest.fn(async () => ({ maxResults: 5 })),
};

const ROUTES: [string, Route][] = [
  ["GET /integrations/web-search/status", { method: "GET", url: (id) => `/integrations/web-search/status?workspaceId=${id}`, calls: { webSearch: "getUserWebSearchStatus" }, hasCredential: true }],
  ["POST /mcp/user/connect", { method: "POST", url: () => "/mcp/user/connect", payload: (id) => ({ provider: PROVIDER, workspaceId: id, env: { NOTION_TOKEN: "rnx206-fake-notion-token" } }), calls: { mcpUser: "connectWithToken" }, hasCredential: false }],
  ["GET /mcp/user/credentials", { method: "GET", url: (id) => `/mcp/user/credentials?workspaceId=${id}`, calls: { mcpUser: "getUserCredentials" }, hasCredential: true }],
  ["DELETE /mcp/user/credentials/:provider", { method: "DELETE", url: (id) => `/mcp/user/credentials/${PROVIDER}?workspaceId=${id}`, calls: { mcpUser: "revokeCredential" }, hasCredential: true }],
];

describe("RNX-206: workspace membership on the MCP credential and web search status routes (Fastify, test database)", () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let app: NestFastifyApplication;
  let mcpUser: McpUserService;
  let owner: Actor;
  let member: Actor;
  let removedMember: Actor;
  let stranger: Actor;
  let workspaceId: string;

  beforeAll(async () => {
    ({ moduleRef, prisma } = await createTestModule({
      controllers: [McpUserController, WebSearchController],
      providers: [
        McpUserService,
        WorkspaceService,
        WorkspaceQuotaService,
        { provide: ConfigService, useValue: new ConfigService({}) },
        { provide: WebSearchService, useValue: webSearch },
      ],
    }));
    app = await createFastifyApp(moduleRef);
    mcpUser = moduleRef.get(McpUserService);
  });

  beforeEach(async () => {
    await resetDatabase(prisma);
    jest.clearAllMocks();
    for (const method of ["connectWithToken", "getUserCredentials", "revokeCredential"] as const) {
      jest.spyOn(mcpUser, method);
    }
    owner = await createUser(prisma);
    member = await createUser(prisma);
    removedMember = await createUser(prisma);
    stranger = await createUser(prisma);
    workspaceId = (await createWorkspace(prisma, { ownerId: owner.id })).id;
    await prisma.workspaceMember.createMany({
      data: [
        { workspaceId, userId: owner.id, role: "owner", status: "active", joinedAt: new Date() },
        { workspaceId, userId: member.id, role: "member", status: "active", joinedAt: new Date() },
        { workspaceId, userId: removedMember.id, role: "member", status: "removed", joinedAt: new Date() },
      ],
    });
    const enterprise = await createPlan(prisma, { slug: "enterprise" });
    await createSubscription(prisma, { userId: owner.id, planId: enterprise.id });
  });

  afterEach(() => jest.restoreAllMocks());

  afterAll(() => app?.close());

  const auth = (user: Actor) => ({
    authorization: `Bearer ${jwt.sign({ userId: user.id, email: user.email }, process.env.JWT_SECRET!)}`,
  });

  const call = (route: Route, actor: Actor, wsId: string) =>
    app.inject({ method: route.method, url: route.url(wsId), headers: auth(actor), payload: route.payload?.(wsId) });

  const credentialRows = () => prisma.userMcpCredential.findMany({ orderBy: { id: "asc" } });

  /** A credential the actor already holds in the workspace (stored while they still had access). */
  const seedCredential = (actor: Actor, wsId: string) =>
    prisma.userMcpCredential.create({
      data: { userId: actor.id, workspaceId: wsId, provider: PROVIDER, envEncrypted: "rnx206-fake-ciphertext", status: "connected" },
    });

  const serviceMock = (route: Route) =>
    "mcpUser" in route.calls ? (mcpUser[route.calls.mcpUser] as jest.Mock) : webSearch[route.calls.webSearch];

  const expectNoServiceCalled = () => {
    expect(mcpUser.connectWithToken).not.toHaveBeenCalled();
    expect(mcpUser.getUserCredentials).not.toHaveBeenCalled();
    expect(mcpUser.revokeCredential).not.toHaveBeenCalled();
    expect(webSearch.getUserWebSearchStatus).not.toHaveBeenCalled();
  };

  /** Each refused case: who calls, on which workspace, and the refusal they get. */
  const REFUSALS: [string, () => Promise<{ actor: Actor; wsId: string }>, number, string][] = [
    ["AC 1: a user who is not a member", async () => ({ actor: stranger, wsId: workspaceId }), 403, NOT_A_MEMBER],
    ["AC 4: a removed (inactive) member", async () => ({ actor: removedMember, wsId: workspaceId }), 403, NOT_A_MEMBER],
    [
      "AC 4: an active member whose workspace owner's plan has no collaboration (Starter)",
      async () => {
        const starter = await createPlan(prisma, { slug: "starter" });
        await prisma.userSubscription.update({ where: { userId: owner.id }, data: { planId: starter.id } });
        return { actor: member, wsId: workspaceId };
      },
      403,
      NO_COLLABORATION,
    ],
    ["AC 5: the owner on their default workspace", async () => ({ actor: owner, wsId: (await ensureDefaultWorkspace(prisma, owner.id)).id }), 404, NOT_FOUND],
  ];

  describe.each(REFUSALS)("%s", (_case, arrange, status, message) => {
    it.each(ROUTES)("%s: refused like GET /integrations/web-search/policy, no service call, nothing written or returned", async (_name, route) => {
      const { actor, wsId } = await arrange();
      if (route.hasCredential) await seedCredential(actor, wsId);
      const rowsBefore = await credentialRows();

      const res = await call(route, actor, wsId);
      const policyRes = await app.inject({ method: "GET", url: `/integrations/web-search/policy?workspaceId=${wsId}`, headers: auth(actor) });

      expect({ status: res.statusCode, body: res.json() }).toEqual({ status, body: expect.objectContaining({ message }) });
      expect(Object.keys(res.json()).sort()).toEqual(["error", "message", "statusCode"]);
      expect({ status: res.statusCode, body: res.json() }).toEqual({ status: policyRes.statusCode, body: policyRes.json() });
      expectNoServiceCalled();
      expect(await credentialRows()).toEqual(rowsBefore);
    });
  });

  describe("AC 6: POST /mcp/user/connect validates its body (Zod)", () => {
    it.each([
      ["missing provider", (id: string) => ({ workspaceId: id, env: { NOTION_TOKEN: "rnx206-fake-notion-token" } }), "provider"],
      ["a workspaceId that is not a UUID", () => ({ provider: PROVIDER, workspaceId: "not-a-uuid", env: { NOTION_TOKEN: "rnx206-fake-notion-token" } }), "workspaceId"],
      ["an env value that is not a string", (id: string) => ({ provider: PROVIDER, workspaceId: id, env: { NOTION_TOKEN: 123 } }), "env"],
    ])("%s: 400 naming the field, nothing written", async (_name, payload, field) => {
      const res = await app.inject({ method: "POST", url: "/mcp/user/connect", headers: auth(owner), payload: payload(workspaceId) });

      expect(res.statusCode).toBe(400);
      // RNX-28: the one invalid-body shape, the field named in error.details.
      expect(res.json()).toMatchObject({ error: { message: "Invalid request body", type: "invalid_request_error" } });
      expect(res.json().error.details).toHaveProperty(field);
      expect(mcpUser.connectWithToken).not.toHaveBeenCalled();
      expect(await credentialRows()).toEqual([]);
    });
  });

  describe.each([
    ["an active member of the Enterprise owner's workspace", () => member],
    ["the workspace owner", () => owner],
  ])("AC 7 (control): %s", (_who, actorOf) => {
    it.each(ROUTES)("%s behaves as before", async (_name, route) => {
      const actor = actorOf();
      if (route.hasCredential) await seedCredential(actor, workspaceId);

      const res = await call(route, actor, workspaceId);

      expect(res.statusCode).toBe(route.method === "POST" ? 201 : 200);
      expect(serviceMock(route)).toHaveBeenCalledTimes(1);
      const rows = (await credentialRows()).map((row) => ({ userId: row.userId, workspaceId: row.workspaceId, provider: row.provider }));
      const expectedRows = route.method === "DELETE" ? [] : [{ userId: actor.id, workspaceId, provider: PROVIDER }];
      expect(rows).toEqual(expectedRows);
      if (route.method === "GET" && "mcpUser" in route.calls) {
        expect(res.json().map((c: { provider: string }) => c.provider)).toEqual([PROVIDER]);
      }
    });
  });
});
