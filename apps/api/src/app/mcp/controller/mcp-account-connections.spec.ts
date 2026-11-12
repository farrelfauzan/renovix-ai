import { Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { TestingModule } from "@nestjs/testing";
import { NestFastifyApplication } from "@nestjs/platform-fastify";
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
import { createPackageSnapshot, createUser, createWorkspace } from "../../../../test/factories";
import { withdrawCollaboration } from "../../../../test/withdraw-collaboration";
import { asSessionUser } from "../../../../test/as-session-user";

// RNX-292 (D312): an MCP credential belongs to the account (connect once) and is used in a workspace only where its
// owner switched it on (a workspace_mcp_connections row). The routes the chat app calls today (oauth/start, connect,
// credentials, each with workspaceId) keep working; without workspaceId they act on the account. The Brave key is a
// credential like any other. Real McpUserService, WebSearchService, WorkspaceService and test database; every
// provider call (Google token exchange, Brave) is a mocked global fetch. No planted token reaches a log line or a
// response body.
const STATE_SECRET = "rnx292-marker-state-secret-not-a-real-secret";
const GMAIL = "google-gmail";
const BRAVE = "web-search-brave";
const GMAIL_TOKEN = "rnx292-marker-gmail-token-of-x";
const OTHER_TOKEN = "rnx292-marker-gmail-token-of-y";
const OAUTH_REFRESH_TOKEN = "rnx292-marker-oauth-refresh-token";
const BRAVE_KEY = "rnx292-marker-brave-key-000001";
const CHAT_APP_URL = "http://chat.test.local";
const CONFIG = {
  GOOGLE_OAUTH_CLIENT_ID: "rnx292-google-client-id",
  GOOGLE_OAUTH_CLIENT_SECRET: "rnx292-marker-google-client-secret",
  GOOGLE_OAUTH_REDIRECT_URI: "http://api.test.local/mcp/user/oauth/callback",
  CHAT_APP_URL,
};
const MARKERS = [STATE_SECRET, GMAIL_TOKEN, OTHER_TOKEN, OAUTH_REFRESH_TOKEN, BRAVE_KEY, CONFIG.GOOGLE_OAUTH_CLIENT_SECRET];

type Actor = { id: string; email: string };
type Method = "GET" | "POST" | "PUT" | "DELETE";

describe("RNX-292: MCP connections belong to the account, switched on per workspace (Fastify, test database)", () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let app: NestFastifyApplication;
  let mcpUser: McpUserService;
  let webSearch: WebSearchService;
  let owner: Actor;
  let x: Actor;
  let y: Actor;
  let stranger: Actor;
  let workspaceA: string;
  let workspaceB: string;
  let workspaceC: string;
  let logLines: string[];
  let responseBodies: string[];
  let braveTokens: (string | null)[];

  beforeAll(async () => {
    ({ moduleRef, prisma } = await createTestModule({
      controllers: [McpUserController, WebSearchController],
      providers: [
        McpUserService,
        WebSearchService,
        WorkspaceService,
        WorkspaceQuotaService,
        { provide: ConfigService, useValue: new ConfigService(CONFIG) },
      ],
    }));
    app = await createFastifyApp(moduleRef);
    mcpUser = moduleRef.get(McpUserService);
    webSearch = moduleRef.get(WebSearchService);
  });

  beforeEach(async () => {
    process.env.MCP_OAUTH_STATE_SECRET = STATE_SECRET;
    await resetDatabase(prisma);
    owner = await createUser(prisma);
    x = await createUser(prisma);
    y = await createUser(prisma);
    stranger = await createUser(prisma);
    [workspaceA, workspaceB, workspaceC] = await Promise.all(
      [1, 2, 3].map(async () => (await createWorkspace(prisma, { ownerId: owner.id })).id),
    );
    await prisma.workspaceMember.createMany({
      data: [workspaceA, workspaceB, workspaceC].flatMap((workspaceId) => [
        { workspaceId, userId: owner.id, role: "owner", status: "active", joinedAt: new Date() },
        { workspaceId, userId: x.id, role: "member", status: "active", joinedAt: new Date() },
        { workspaceId, userId: y.id, role: "member", status: "active", joinedAt: new Date() },
      ]),
    });
    // RNX-76 B3 (D297): collaboration comes from the owner's package snapshot, so x and y may use the workspaces.
    await createPackageSnapshot(prisma, { userId: owner.id, collaborationEnabled: true });
    logLines = [];
    responseBodies = [];
    braveTokens = [];
    const record = (...args: unknown[]): void => {
      logLines.push(args.map((a) => (typeof a === "string" ? a : JSON.stringify(a) ?? String(a))).join(" "));
    };
    for (const level of ["log", "error", "warn", "debug", "verbose", "fatal"] as const) {
      jest.spyOn(Logger.prototype, level).mockImplementation((...args: unknown[]) => record(...args));
    }
    for (const level of ["log", "error", "warn", "info", "debug"] as const) {
      jest.spyOn(console, level).mockImplementation((...args: unknown[]) => record(...args));
    }
    jest.spyOn(globalThis, "fetch").mockImplementation(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
      if (url.startsWith("https://api.search.brave.com/")) {
        braveTokens.push(new Headers(init?.headers).get("X-Subscription-Token"));
        return json({ web: { results: [{ title: "Brave", url: "https://example.test/a", description: "brave snippet" }] } });
      }
      if (url === "https://oauth2.googleapis.com/token") {
        return json({ access_token: "rnx292-access", refresh_token: OAUTH_REFRESH_TOKEN, token_type: "Bearer", expires_in: 3600, scope: "x" });
      }
      return json({ Heading: "DDG", AbstractURL: "https://example.test/ddg", AbstractText: "ddg snippet", RelatedTopics: [] });
    });
  });

  // AC 11: no token, key or decrypted env reaches a log line, an error message or a response, in any test of this file.
  afterEach(() => {
    const leaked = MARKERS.filter((marker) => [...logLines, ...responseBodies].some((line) => line.includes(marker)));
    jest.restoreAllMocks();
    expect(leaked).toEqual([]);
  });

  afterAll(() => app?.close());

  const send = async (actor: Actor, method: Method, url: string, payload?: object) => {
    const res = await app.inject({ method, url, headers: asSessionUser(actor), payload });
    responseBodies.push(res.body);
    return res;
  };

  const connect = (actor: Actor, env: Record<string, string>, workspaceId?: string) =>
    send(actor, "POST", "/mcp/user/connect", { provider: GMAIL, ...(workspaceId && { workspaceId }), env });

  const switchOn = (actor: Actor, workspaceId: string, provider: string = GMAIL) =>
    send(actor, "PUT", `/mcp/user/credentials/${provider}/workspaces/${workspaceId}`);

  /** The credential rows, as (user, provider). */
  const credentials = async () =>
    (await prisma.userMcpCredential.findMany({ orderBy: { createdAt: "asc" } })).map((c) => ({ userId: c.userId, provider: c.provider }));

  /** The switch rows, as (user, provider, workspace), sorted. */
  const switches = async () =>
    (await prisma.workspaceMcpConnection.findMany({ include: { credential: true } }))
      .map((c) => ({ userId: c.credential.userId, provider: c.credential.provider, workspaceId: c.workspaceId }))
      .sort((a, b) => `${a.userId}${a.provider}${a.workspaceId}`.localeCompare(`${b.userId}${b.provider}${b.workspaceId}`));

  const sorted = <T extends { userId: string; provider: string; workspaceId: string }>(rows: T[]): T[] =>
    [...rows].sort((a, b) => `${a.userId}${a.provider}${a.workspaceId}`.localeCompare(`${b.userId}${b.provider}${b.workspaceId}`));

  /** Starts an OAuth flow from the chat app (with workspaceId, or none) and returns its state and cookie. */
  const startFlow = async (actor: Actor, workspaceId?: string) => {
    const query = workspaceId ? `&workspaceId=${workspaceId}` : "";
    const res = await send(actor, "GET", `/mcp/user/oauth/start?provider=${GMAIL}${query}`);
    expect(res.statusCode).toBe(200);
    const state = new URL(res.json().authUrl).searchParams.get("state") as string;
    const cookie = String(res.headers["set-cookie"]).split(";")[0];
    return { state, cookie };
  };

  const callback = async ({ state, cookie }: { state: string; cookie: string }) => {
    const res = await app.inject({
      method: "GET",
      url: `/mcp/user/oauth/callback?code=rnx292-code&state=${encodeURIComponent(state)}`,
      headers: { cookie },
    });
    expect(res.statusCode).toBe(302);
    return new URL(String(res.headers.location)).searchParams.get("oauth");
  };

  describe("AC 1: connect once, switch on in A and B", () => {
    it("by token: one credential row and two switch rows; the credential resolves in A and in B", async () => {
      expect((await connect(x, { GOOGLE_REFRESH_TOKEN: GMAIL_TOKEN }, workspaceA)).statusCode).toBe(201);
      const on = await switchOn(x, workspaceB);

      expect({ status: on.statusCode, body: on.json() }).toEqual({ status: 200, body: { enabled: true, provider: GMAIL, workspaceId: workspaceB } });
      expect(await credentials()).toEqual([{ userId: x.id, provider: GMAIL }]);
      expect(await switches()).toEqual(sorted([
        { userId: x.id, provider: GMAIL, workspaceId: workspaceA },
        { userId: x.id, provider: GMAIL, workspaceId: workspaceB },
      ]));
      for (const workspaceId of [workspaceA, workspaceB]) {
        await expect(mcpUser.resolveCredentials(x.id, workspaceId, GMAIL)).resolves.toEqual({ GOOGLE_REFRESH_TOKEN: GMAIL_TOKEN });
        expect(Object.fromEntries(await mcpUser.getUserConnectedProviders(x.id, workspaceId))).toEqual({ [GMAIL]: { GOOGLE_REFRESH_TOKEN: GMAIL_TOKEN } });
      }
    });

    it("by OAuth from A, then again from B: still one credential row (replaced), switched on in A and B", async () => {
      expect(await callback(await startFlow(x, workspaceA))).toBe("success");
      const [first] = await prisma.userMcpCredential.findMany();
      expect(await callback(await startFlow(x, workspaceB))).toBe("success");

      const rows = await prisma.userMcpCredential.findMany();
      expect(rows.map((row) => row.id)).toEqual([first.id]);
      expect(await switches()).toEqual(sorted([
        { userId: x.id, provider: GMAIL, workspaceId: workspaceA },
        { userId: x.id, provider: GMAIL, workspaceId: workspaceB },
      ]));
    });

    it("the account list (no workspaceId) shows each connection with the workspaces it is on in; a switch twice adds no row", async () => {
      await connect(x, { GOOGLE_REFRESH_TOKEN: GMAIL_TOKEN }, workspaceA);
      await switchOn(x, workspaceB);
      await switchOn(x, workspaceB);

      const res = await send(x, "GET", "/mcp/user/credentials");

      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual([
        { id: expect.any(String), provider: GMAIL, status: "connected", connectedAt: expect.any(String), expiresAt: null, workspaceIds: [workspaceA, workspaceB] },
      ]);
      expect(await switches()).toHaveLength(2);
    });
  });

  describe("AC 2: switched on in A, not in C", () => {
    it("in C the credential is not listed and resolveCredentials returns null; no provider is offered (negative)", async () => {
      await connect(x, { GOOGLE_REFRESH_TOKEN: GMAIL_TOKEN }, workspaceA);

      const listedInC = await send(x, "GET", `/mcp/user/credentials?workspaceId=${workspaceC}`);
      const listedInA = await send(x, "GET", `/mcp/user/credentials?workspaceId=${workspaceA}`);

      expect(listedInC.json()).toEqual([]);
      expect(listedInA.json().map((c: { provider: string }) => c.provider)).toEqual([GMAIL]);
      await expect(mcpUser.resolveCredentials(x.id, workspaceC, GMAIL)).resolves.toBeNull();
      expect((await mcpUser.getUserConnectedProviders(x.id, workspaceC)).size).toBe(0);
    });

    it("the Brave key behaves the same: on in A, not resolved, not shown and not used in C", async () => {
      expect((await send(x, "PUT", "/integrations/web-search/brave/key", { workspaceId: workspaceA, apiKey: BRAVE_KEY })).statusCode).toBe(200);
      braveTokens = [];

      const statusInC = await send(x, "GET", `/integrations/web-search/status?workspaceId=${workspaceC}`);
      const answerInC = await webSearch.search(x.id, workspaceC, "rnx292 in c");
      responseBodies.push(answerInC);
      const answerInA = await webSearch.search(x.id, workspaceA, "rnx292 in a");
      responseBodies.push(answerInA);

      await expect(mcpUser.resolveCredentials(x.id, workspaceC, BRAVE)).resolves.toBeNull();
      expect(statusInC.json()).toMatchObject({ connected: false, maskedKey: null });
      expect(answerInC).toBe('Web search is not configured for this user. Please connect your Brave API key in Integrations settings. Query: "rnx292 in c"');
      expect(answerInA).toContain("via brave-search");
      expect(braveTokens).toEqual([BRAVE_KEY]);
    });
  });

  it("AC 3: X's credential is on in A; Y, another member of A, never gets it (negative)", async () => {
    await connect(x, { GOOGLE_REFRESH_TOKEN: GMAIL_TOKEN }, workspaceA);
    await send(x, "PUT", "/integrations/web-search/brave/key", { workspaceId: workspaceA, apiKey: BRAVE_KEY });

    await expect(mcpUser.resolveCredentials(y.id, workspaceA, GMAIL)).resolves.toBeNull();
    await expect(mcpUser.resolveCredentials(y.id, workspaceA, BRAVE)).resolves.toBeNull();
    expect((await mcpUser.getUserConnectedProviders(y.id, workspaceA)).size).toBe(0);
    expect((await send(y, "GET", `/mcp/user/credentials?workspaceId=${workspaceA}`)).json()).toEqual([]);
  });

  describe("AC 4: switching on where requireMembership refuses adds no row (negative)", () => {
    const CASES: [string, () => Promise<{ actor: Actor; workspaceId: string }>, number, string][] = [
      ["a non-member", async () => ({ actor: stranger, workspaceId: workspaceA }), 403, "Not a member of this workspace"],
      [
        "a removed member",
        async () => {
          await prisma.workspaceMember.updateMany({ where: { workspaceId: workspaceA, userId: x.id }, data: { status: "removed" } });
          return { actor: x, workspaceId: workspaceA };
        },
        403,
        "Not a member of this workspace",
      ],
      [
        "a member where the owner's package disallows collaboration",
        async () => {
          withdrawCollaboration(owner.id);
          return { actor: x, workspaceId: workspaceA };
        },
        403,
        "Workspace collaboration requires an Enterprise plan.",
      ],
      ["the caller's own default workspace", async () => ({ actor: x, workspaceId: (await ensureDefaultWorkspace(prisma, x.id)).id }), 404, "Workspace not found"],
    ];

    it.each(CASES)("%s: the requireMembership answer, nothing written", async (_case, arrange, status, message) => {
      for (const actor of [x, stranger]) await connect(actor, { GOOGLE_REFRESH_TOKEN: actor === x ? GMAIL_TOKEN : OTHER_TOKEN });
      const { actor, workspaceId } = await arrange();

      const res = await switchOn(actor, workspaceId);

      expect({ status: res.statusCode, message: res.json().message }).toEqual({ status, message });
      expect(await switches()).toEqual([]);
    });
  });

  it("AC 5: switching on a provider that is not connected is 404 and changes nothing", async () => {
    await connect(x, { GOOGLE_REFRESH_TOKEN: GMAIL_TOKEN }, workspaceA);
    const before = { credentials: await credentials(), switches: await switches() };

    const res = await switchOn(x, workspaceB, "github");
    const othersCredential = await switchOn(y, workspaceB);

    expect({ status: res.statusCode, message: res.json().message }).toEqual({ status: 404, message: "Credential not found" });
    expect({ status: othersCredential.statusCode, message: othersCredential.json().message }).toEqual({ status: 404, message: "Credential not found" });
    expect({ credentials: await credentials(), switches: await switches() }).toEqual(before);
  });

  describe("AC 6: disconnect", () => {
    beforeEach(async () => {
      await connect(x, { GOOGLE_REFRESH_TOKEN: GMAIL_TOKEN }, workspaceA);
      await switchOn(x, workspaceB);
    });

    it("DELETE with workspaceId=A switches off only A; the credential still works in B", async () => {
      const res = await send(x, "DELETE", `/mcp/user/credentials/${GMAIL}?workspaceId=${workspaceA}`);

      expect({ status: res.statusCode, body: res.json() }).toEqual({ status: 200, body: { disconnected: true, provider: GMAIL } });
      expect(await credentials()).toEqual([{ userId: x.id, provider: GMAIL }]);
      expect(await switches()).toEqual([{ userId: x.id, provider: GMAIL, workspaceId: workspaceB }]);
      await expect(mcpUser.resolveCredentials(x.id, workspaceA, GMAIL)).resolves.toBeNull();
      await expect(mcpUser.resolveCredentials(x.id, workspaceB, GMAIL)).resolves.toEqual({ GOOGLE_REFRESH_TOKEN: GMAIL_TOKEN });
    });

    it("DELETE without workspaceId removes the account credential and every switch of it", async () => {
      const res = await send(x, "DELETE", `/mcp/user/credentials/${GMAIL}`);

      expect({ status: res.statusCode, body: res.json() }).toEqual({ status: 200, body: { disconnected: true, provider: GMAIL } });
      expect(await credentials()).toEqual([]);
      expect(await switches()).toEqual([]);
    });

    it("DELETE with an empty workspaceId is refused (400) and is never read as disconnecting the account", async () => {
      const res = await send(x, "DELETE", `/mcp/user/credentials/${GMAIL}?workspaceId=`);

      expect(res.statusCode).toBe(400);
      expect(await credentials()).toEqual([{ userId: x.id, provider: GMAIL }]);
      expect(await switches()).toHaveLength(2);
    });
  });

  describe("AC 7: today's chat calls, each with workspaceId, work unchanged", () => {
    it("OAuth started from A (oauth/start?provider&workspaceId): connected and switched on in A, listed there", async () => {
      expect(await callback(await startFlow(x, workspaceA))).toBe("success");

      const listed = await send(x, "GET", `/mcp/user/credentials?workspaceId=${workspaceA}`);

      expect(await credentials()).toEqual([{ userId: x.id, provider: GMAIL }]);
      expect(await switches()).toEqual([{ userId: x.id, provider: GMAIL, workspaceId: workspaceA }]);
      expect(listed.json().map((c: { provider: string }) => c.provider)).toEqual([GMAIL]);
      await expect(mcpUser.resolveCredentials(x.id, workspaceA, GMAIL)).resolves.toMatchObject({ GOOGLE_REFRESH_TOKEN: OAUTH_REFRESH_TOKEN });
    });

    it("token (POST /mcp/user/connect {provider, workspaceId, env}): connected and switched on in A, listed there", async () => {
      const res = await connect(x, { GOOGLE_REFRESH_TOKEN: GMAIL_TOKEN }, workspaceA);
      const listed = await send(x, "GET", `/mcp/user/credentials?workspaceId=${workspaceA}`);

      expect({ status: res.statusCode, body: res.json() }).toEqual({ status: 201, body: { connected: true, provider: GMAIL } });
      expect(await switches()).toEqual([{ userId: x.id, provider: GMAIL, workspaceId: workspaceA }]);
      expect(listed.json()).toEqual([
        { id: expect.any(String), provider: GMAIL, status: "connected", connectedAt: expect.any(String), expiresAt: null },
      ]);
    });

    it("a member who lost access between start and callback: the credential is stored, no switch is added", async () => {
      const flow = await startFlow(x, workspaceA);
      await prisma.workspaceMember.updateMany({ where: { workspaceId: workspaceA, userId: x.id }, data: { status: "removed" } });

      expect(await callback(flow)).toBe("success");
      expect(await credentials()).toEqual([{ userId: x.id, provider: GMAIL }]);
      expect(await switches()).toEqual([]);
    });

    it("connect and oauth/start without workspaceId act on the account only (no switch)", async () => {
      await connect(y, { GOOGLE_REFRESH_TOKEN: OTHER_TOKEN });
      expect(await callback(await startFlow(x))).toBe("success");

      expect(await credentials()).toEqual(expect.arrayContaining([{ userId: x.id, provider: GMAIL }, { userId: y.id, provider: GMAIL }]));
      expect(await switches()).toEqual([]);
    });
  });

  describe("AC 8: the workspace is read only from the stored flow row, never from the signed state", () => {
    it("the signed payload has no workspace; the row's workspace is the one switched on", async () => {
      const flow = await startFlow(x, workspaceA);
      const payload = JSON.parse(Buffer.from(flow.state.split(".")[0], "base64url").toString("utf8"));
      expect(Object.keys(payload).sort()).toEqual(["exp", "n", "p", "u"]);
      // Server side only: the stored row names the workspace (moved to B here to show where it is read from).
      await prisma.mcpOAuthState.updateMany({ data: { workspaceId: workspaceB } });

      expect(await callback(flow)).toBe("success");
      expect(await switches()).toEqual([{ userId: x.id, provider: GMAIL, workspaceId: workspaceB }]);
    });

    it("a flow started from no workspace stores a null workspace on its row and switches nothing on", async () => {
      const flow = await startFlow(x);

      expect(await prisma.mcpOAuthState.findMany({ select: { workspaceId: true } })).toEqual([{ workspaceId: null }]);
      expect(await callback(flow)).toBe("success");
      expect(await switches()).toEqual([]);
    });
  });

  describe("AC 12: the web search key routes, with and without workspaceId", () => {
    const status = (actor: Actor, workspaceId: string) => send(actor, "GET", `/integrations/web-search/status?workspaceId=${workspaceId}`);

    it.each([
      ["PUT /integrations/web-search/brave/key", "/integrations/web-search/brave/key"],
      ["PUT /integrations/web-search/providers/:provider/key", "/integrations/web-search/providers/brave-search/key"],
    ])("%s: without workspaceId stores the account key only; with it, also switches it on there", async (_route, url) => {
      const account = await send(x, "PUT", url, { apiKey: BRAVE_KEY });
      const afterAccount = await switches();
      const inA = await send(x, "PUT", url, { workspaceId: workspaceA, apiKey: BRAVE_KEY });

      expect([account.statusCode, inA.statusCode]).toEqual([200, 200]);
      expect(afterAccount).toEqual([]);
      expect(await credentials()).toEqual([{ userId: x.id, provider: BRAVE }]);
      expect(await switches()).toEqual([{ userId: x.id, provider: BRAVE, workspaceId: workspaceA }]);
      expect((await status(x, workspaceA)).json()).toMatchObject({ connected: true });
      expect((await status(x, workspaceB)).json()).toMatchObject({ connected: false });
    });

    it("DELETE with workspaceId switches it off there and keeps the key; without, removes the key and its switches", async () => {
      await send(x, "PUT", "/integrations/web-search/brave/key", { workspaceId: workspaceA, apiKey: BRAVE_KEY });
      await send(x, "PUT", "/integrations/web-search/brave/key", { workspaceId: workspaceB, apiKey: BRAVE_KEY });

      const offInA = await send(x, "DELETE", `/integrations/web-search/brave/key?workspaceId=${workspaceA}`);
      const afterOffInA = { credentials: await credentials(), switches: await switches() };
      const emptyWorkspace = await send(x, "DELETE", "/integrations/web-search/brave/key?workspaceId=");
      const account = await send(x, "DELETE", "/integrations/web-search/brave/key");

      expect([offInA.statusCode, emptyWorkspace.statusCode, account.statusCode]).toEqual([200, 400, 200]);
      expect(afterOffInA).toEqual({ credentials: [{ userId: x.id, provider: BRAVE }], switches: [{ userId: x.id, provider: BRAVE, workspaceId: workspaceB }] });
      expect(await credentials()).toEqual([]);
      expect(await switches()).toEqual([]);
    });

    it("the default workspace still answers 404 on each key route, and nothing is written", async () => {
      await send(x, "PUT", "/integrations/web-search/brave/key", { workspaceId: workspaceA, apiKey: BRAVE_KEY });
      const before = { credentials: await credentials(), switches: await switches() };
      const defaultId = (await ensureDefaultWorkspace(prisma, x.id)).id;

      const answers = [
        await send(x, "PUT", "/integrations/web-search/brave/key", { workspaceId: defaultId, apiKey: BRAVE_KEY }),
        await send(x, "PUT", "/integrations/web-search/providers/brave-search/key", { workspaceId: defaultId, apiKey: BRAVE_KEY }),
        await send(x, "DELETE", `/integrations/web-search/brave/key?workspaceId=${defaultId}`),
        await switchOn(x, defaultId, BRAVE),
      ];

      expect(answers.map((res) => [res.statusCode, res.json().message])).toEqual(Array(4).fill([404, "Workspace not found"]));
      expect({ credentials: await credentials(), switches: await switches() }).toEqual(before);
    });
  });
});
