import { TestingModule } from "@nestjs/testing";
import { NestFastifyApplication } from "@nestjs/platform-fastify";
import * as jwt from "jsonwebtoken";
import { WebSearchController } from "./web-search.controller";
import { WebSearchService } from "../service/web-search.service";
import { WorkspaceService } from "../../workspace/service/workspace.service";
import { WorkspaceQuotaService } from "../../workspace/service/workspace-quota.service";
import { PrismaService } from "../../prisma/prisma.service";
import { createFastifyApp, createTestModule } from "../../../../test/test-module";
import { resetDatabase } from "../../../../test/test-database";
import { createAgent, createUser, createWorkspace } from "../../../../test/factories";

// RNX-117 (D219 a): the web search integration routes that check the caller's workspace membership answer
// 404 "Workspace not found" for the caller's default workspace and change nothing; the owner's normal
// workspace works as before (control). Real controller, WorkspaceService and test database; WebSearchService
// is a stub (its module loads ESM packages, and the brave key routes would call the network), so "changes
// nothing" is: no service call and no workspace row changed.
jest.mock("../../../lib/auth", () => ({ auth: { api: { getSession: async () => null } } }));
jest.mock("../service/web-search.service", () => ({ WebSearchService: class {} }));

process.env.JWT_SECRET = "rnx117-web-search-test-jwt-secret";

type Route = {
  method: "GET" | "PUT" | "DELETE";
  url: (workspaceId: string) => string;
  payload?: (workspaceId: string) => object;
  called: keyof typeof webSearch;
};

const webSearch = {
  upsertBraveApiKey: jest.fn(async () => ({ ok: true })),
  revokeBraveApiKey: jest.fn(async () => ({ ok: true })),
  getPolicy: jest.fn(async () => ({ ok: true })),
  updatePolicy: jest.fn(async () => ({ ok: true })),
  getUserWebSearchStatus: jest.fn(async () => ({ ok: true })),
};

const ROUTES: [string, Route][] = [
  // RNX-206: the status route checks membership too.
  ["GET /integrations/web-search/status", { method: "GET", url: (id) => `/integrations/web-search/status?workspaceId=${id}`, called: "getUserWebSearchStatus" }],
  ["PUT /integrations/web-search/brave/key", { method: "PUT", url: () => "/integrations/web-search/brave/key", payload: (id) => ({ workspaceId: id, apiKey: "fake-brave-key" }), called: "upsertBraveApiKey" }],
  ["DELETE /integrations/web-search/brave/key", { method: "DELETE", url: (id) => `/integrations/web-search/brave/key?workspaceId=${id}`, called: "revokeBraveApiKey" }],
  ["GET /integrations/web-search/policy", { method: "GET", url: (id) => `/integrations/web-search/policy?workspaceId=${id}`, called: "getPolicy" }],
  ["PUT /integrations/web-search/policy", { method: "PUT", url: () => "/integrations/web-search/policy", payload: (id) => ({ workspaceId: id, maxResults: 3 }), called: "updatePolicy" }],
  ["PUT /integrations/web-search/providers/brave-search/key", { method: "PUT", url: () => "/integrations/web-search/providers/brave-search/key", payload: (id) => ({ workspaceId: id, apiKey: "fake-brave-key" }), called: "upsertBraveApiKey" }],
];

describe("RNX-117: web search routes hide the default workspace (Fastify, test database)", () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let app: NestFastifyApplication;

  beforeAll(async () => {
    ({ moduleRef, prisma } = await createTestModule({
      controllers: [WebSearchController],
      providers: [WorkspaceService, WorkspaceQuotaService, { provide: WebSearchService, useValue: webSearch }],
    }));
    app = await createFastifyApp(moduleRef);
  });

  beforeEach(async () => {
    await resetDatabase(prisma);
    jest.clearAllMocks();
  });

  afterAll(() => app?.close());

  const auth = (user: { id: string; email: string }) => ({
    authorization: `Bearer ${jwt.sign({ userId: user.id, email: user.email }, process.env.JWT_SECRET!)}`,
  });

  const readRows = () =>
    Promise.all([prisma.workspace.findMany({ orderBy: { id: "asc" } }), prisma.workspaceMember.findMany({ orderBy: { id: "asc" } }), prisma.appConfig.findMany()]);

  /** An owner with an agent in the default workspace and a normal workspace with its owner member row. */
  const setup = async () => {
    const owner = await createUser(prisma);
    const agent = await createAgent(prisma, { userId: owner.id });
    const normal = await createWorkspace(prisma, { ownerId: owner.id });
    await prisma.workspaceMember.create({ data: { workspaceId: normal.id, userId: owner.id, role: "owner" } });
    return { owner, defaultWorkspaceId: agent.workspaceId, normalWorkspaceId: normal.id };
  };

  const call = (route: Route, workspaceId: string, owner: { id: string; email: string }) =>
    app.inject({ method: route.method, url: route.url(workspaceId), headers: auth(owner), payload: route.payload?.(workspaceId) });

  it.each(ROUTES)("%s with the default workspace: 404 Workspace not found, nothing changes", async (_name, route) => {
    const { owner, defaultWorkspaceId } = await setup();
    const rowsBefore = await readRows();

    const res = await call(route, defaultWorkspaceId, owner);

    expect({ status: res.statusCode, message: res.json().message }).toEqual({ status: 404, message: "Workspace not found" });
    expect(await readRows()).toEqual(rowsBefore);
    for (const method of Object.values(webSearch)) expect(method).not.toHaveBeenCalled();
  });

  it.each(ROUTES)("control: %s with the owner's normal workspace reaches the service (200)", async (_name, route) => {
    const { owner, normalWorkspaceId } = await setup();

    const res = await call(route, normalWorkspaceId, owner);

    expect(res.statusCode).toBe(200);
    expect(webSearch[route.called]).toHaveBeenCalledTimes(1);
  });
});
