import { Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { TestingModule } from "@nestjs/testing";
import { NestFastifyApplication } from "@nestjs/platform-fastify";
import { McpUserController } from "./mcp-user.controller";
import { McpUserService } from "../service/mcp-user.service";
import { McpOAuthStateRepository } from "../repository/mcp-oauth-state.repository";
import { PrismaService } from "../../prisma/prisma.service";
import { WorkspaceService } from "../../workspace/service/workspace.service";
import { WorkspaceQuotaService } from "../../workspace/service/workspace-quota.service";
import { createFastifyApp, createTestModule } from "../../../../test/test-module";
import { resetDatabase } from "../../../../test/test-database";
import { createPackageSnapshot, createPlan, createSubscription, createUser, createWorkspace } from "../../../../test/factories";
import { asSessionUser } from "../../../../test/as-session-user";

// RX-152: the public OAuth callback completes a flow only in the browser that started it. The start
// response sets the flow's one-time value (the `n` of RX-151's signed state) as a cookie per provider;
// the callback refuses unless that cookie equals the state's value, and every reply clears it. The
// provider token exchange (global fetch) is mocked: no provider is called.
// RNX-206: start and callback check the workspace with WorkspaceService.requireMembership, so userA has
// its owner member row (as WorkspaceService.create makes it) and is on the Enterprise plan, which lets
// userB (a member) use the workspace under the collaboration rule (RX-113).
const STATE_SECRET = "rx152-marker-state-secret-not-a-real-secret";
const GMAIL = "google-gmail";
const GITHUB = "github";
const CHAT_APP_URL = "http://chat.test.local";
const CONFIG = {
  GOOGLE_OAUTH_CLIENT_ID: "rx152-google-client-id",
  GOOGLE_OAUTH_CLIENT_SECRET: "rx152-marker-google-client-secret",
  GOOGLE_OAUTH_REDIRECT_URI: "http://api.test.local/mcp/user/oauth/callback",
  GITHUB_OAUTH_CLIENT_ID: "rx152-github-client-id",
  GITHUB_OAUTH_CLIENT_SECRET: "rx152-marker-github-client-secret",
  GITHUB_OAUTH_REDIRECT_URI: "http://api.test.local/mcp/user/oauth/callback",
  CHAT_APP_URL,
};
const STATE_TTL_SECONDS = 600;
/** Base64url of 32 random bytes. */
const ONE_TIME_VALUE = "[A-Za-z0-9_-]{43}";

type Actor = { id: string; email: string };
/** A started flow: its state and the `name=value` cookie the start response set in the browser. */
type Flow = { state: string; cookie: string; name: string };
type Reply = { statusCode: number; headers: Record<string, unknown> };

describe("MCP OAuth callback tied to the starting browser (RX-152, Fastify, test database)", () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let app: NestFastifyApplication;
  let userA: Actor;
  let userB: Actor;
  let workspaceId: string;
  let codeCount = 0;
  let tokenCount = 0;
  let markers: string[] = [];
  let logLines: string[] = [];
  let fetchStatus = 200;

  beforeAll(async () => {
    ({ moduleRef, prisma } = await createTestModule({
      controllers: [McpUserController],
      providers: [
        McpUserService,
        WorkspaceService,
        WorkspaceQuotaService,
        { provide: ConfigService, useValue: new ConfigService(CONFIG) },
      ],
    }));
    app = await createFastifyApp(moduleRef);
  });

  beforeEach(async () => {
    process.env.MCP_OAUTH_STATE_SECRET = STATE_SECRET;
    await resetDatabase(prisma);
    userA = await createUser(prisma);
    userB = await createUser(prisma);
    workspaceId = (await createWorkspace(prisma, { ownerId: userA.id })).id;
    await prisma.workspaceMember.createMany({
      data: [
        { workspaceId, userId: userA.id, role: "owner", status: "active", joinedAt: new Date() },
        { workspaceId, userId: userB.id, role: "member", status: "active", joinedAt: new Date() },
      ],
    });
    const enterprise = await createPlan(prisma, { slug: "enterprise" });
    await createSubscription(prisma, { userId: userA.id, planId: enterprise.id });
    // RNX-76 B3 (D297): collaboration comes from the owner's package snapshot, not the plan.
    await createPackageSnapshot(prisma, { userId: userA.id, collaborationEnabled: true });
    markers = [STATE_SECRET, CONFIG.GOOGLE_OAUTH_CLIENT_SECRET, CONFIG.GITHUB_OAUTH_CLIENT_SECRET];
    logLines = [];
    fetchStatus = 200;
    const record = (...args: unknown[]): void => {
      logLines.push(args.map((a) => (typeof a === "string" ? a : JSON.stringify(a) ?? String(a))).join(" "));
    };
    for (const level of ["log", "error", "warn", "debug", "verbose", "fatal"] as const) {
      const original = Logger.prototype[level];
      jest.spyOn(Logger.prototype, level).mockImplementation(function (this: Logger, ...args: unknown[]) {
        record(...args);
        return (original as (...a: unknown[]) => void).apply(this, args);
      });
    }
    for (const level of ["log", "error", "warn", "info", "debug"] as const) {
      const original = console[level];
      jest.spyOn(console, level).mockImplementation((...args: unknown[]) => {
        record(...args);
        original(...args);
      });
    }
    jest.spyOn(globalThis, "fetch").mockImplementation(async () => {
      if (fetchStatus !== 200) return new Response(JSON.stringify({ error: "invalid_grant" }), { status: fetchStatus });
      tokenCount += 1;
      const accessToken = `rx152-marker-access-token-${tokenCount}`;
      const refreshToken = `rx152-marker-refresh-token-${tokenCount}`;
      markers.push(accessToken, refreshToken);
      const body = { access_token: accessToken, refresh_token: refreshToken, token_type: "Bearer", expires_in: 3600, scope: "x" };
      return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
    });
  });

  // AC 8: no cookie value, state, code, token or secret reaches a log line, in any of these tests.
  afterEach(() => {
    const leaked = markers.filter((marker) => logLines.some((line) => line.includes(marker)));
    jest.restoreAllMocks();
    expect(leaked).toEqual([]);
  });

  afterAll(() => app?.close());

  const auth = (user: Actor) => asSessionUser(user);

  const start = (user: Actor, provider: string = GMAIL) =>
    app.inject({
      method: "GET",
      url: `/mcp/user/oauth/start?provider=${provider}&workspaceId=${workspaceId}`,
      headers: auth(user),
    });

  /** Starts a flow in a browser and returns its state and the cookie the start response set. */
  const startFlow = async (user: Actor, provider: string = GMAIL): Promise<Flow> => {
    const res = await start(user, provider);
    expect(res.statusCode).toBe(200);
    const state = new URL(res.json().authUrl).searchParams.get("state")!;
    // No Set-Cookie (as before RX-152) gives an empty cookie, so the callback checks fail on their own assertions.
    const [cookie] = String(res.headers["set-cookie"] ?? "").split(";");
    const name = cookie.includes("=") ? cookie.slice(0, cookie.indexOf("=")) : "";
    markers.push(...[state, cookie.slice(name.length + 1)].filter(Boolean));
    return { state, cookie, name };
  };

  /** The callback as the browser sends it, with the given Cookie header (none when omitted). */
  const callback = (state: string, cookieHeader?: string, code?: string) => {
    codeCount += 1;
    const sentCode = code ?? `rx152-marker-code-${codeCount}`;
    markers.push(...[sentCode, state].filter(Boolean));
    const query = [sentCode && `code=${encodeURIComponent(sentCode)}`, `state=${encodeURIComponent(state)}`].filter(Boolean).join("&");
    return app.inject({
      method: "GET",
      url: `/mcp/user/oauth/callback?${query}`,
      headers: cookieHeader === undefined ? {} : { cookie: cookieHeader },
    });
  };

  const oauthResult = (res: Reply) => {
    expect(res.statusCode).toBe(302);
    const location = String(res.headers.location);
    expect(location.startsWith(`${CHAT_APP_URL}/agents`)).toBe(true);
    for (const marker of markers) expect(location).not.toContain(marker);
    return new URL(location).searchParams.get("oauth");
  };

  /** The reply clears the flow's cookie: same name and attributes, empty value, Max-Age=0. */
  const expectCleared = (res: Reply, name: string) => {
    expect(res.headers["set-cookie"]).toBe(`${name}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`);
  };

  const credentials = () => prisma.userMcpCredential.findMany();
  const stateRowCount = async (): Promise<number> => {
    const [{ n }] = await prisma.$queryRawUnsafe<{ n: number }[]>("SELECT count(*)::int AS n FROM mcp_oauth_states");
    return n;
  };

  it("AC 1: a valid fresh state and no cookie stores nothing, exchanges no code, and clears the cookie", async () => {
    const flow = await startFlow(userA);
    const res = await callback(flow.state);
    expect(oauthResult(res)).toBe("error");
    expectCleared(res, flow.name);
    expect(await credentials()).toEqual([]);
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it("AC 2: a cookie from another flow (a different one-time value) is refused and nothing is stored", async () => {
    const first = await startFlow(userA);
    const second = await startFlow(userA);
    expect(second.name).toBe(first.name);
    const res = await callback(first.state, second.cookie);
    expect(oauthResult(res)).toBe("error");
    expectCleared(res, first.name);
    expect(await credentials()).toEqual([]);
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it("AC 3: B's link opened in A's browser (A's cookie, B's valid state) stores nothing for either user", async () => {
    const flowA = await startFlow(userA);
    const flowB = await startFlow(userB);
    const res = await callback(flowB.state, flowA.cookie);
    expect(oauthResult(res)).toBe("error");
    expectCleared(res, flowB.name);
    expect(await credentials()).toEqual([]);
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it("decision: a refused cookie uses up the state's one-time value; the starter's own browser cannot replay it", async () => {
    const flowA = await startFlow(userA);
    const flowB = await startFlow(userB);
    expect(oauthResult(await callback(flowB.state, flowA.cookie))).toBe("error");
    expect(await stateRowCount()).toBe(1);
    expect(oauthResult(await callback(flowB.state, flowB.cookie))).toBe("error");
    expect(await credentials()).toEqual([]);
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it("AC 4: a valid state and matching cookie used once already are refused, the credential unchanged", async () => {
    const flow = await startFlow(userA);
    expect(oauthResult(await callback(flow.state, flow.cookie))).toBe("success");
    const [before] = await credentials();
    const res = await callback(flow.state, flow.cookie);
    expect(oauthResult(res)).toBe("error");
    expectCleared(res, flow.name);
    const after = await credentials();
    expect(after).toHaveLength(1);
    expect(after[0].envEncrypted).toBe(before.envEncrypted);
    expect(after[0].connectedAt).toEqual(before.connectedAt);
    expect(after[0].updatedAt).toEqual(before.updatedAt);
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
  });

  it("AC 5: a valid state and the matching cookie store the credential for the starter and clear the cookie", async () => {
    const flow = await startFlow(userB);
    const res = await callback(flow.state, `theme=dark; ${flow.cookie}`);
    expect(oauthResult(res)).toBe("success");
    expectCleared(res, flow.name);
    const rows = await credentials();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ userId: userB.id, workspaceId, provider: GMAIL, status: "connected" });
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
  });

  describe("AC 6: the start response's cookie and caching headers", () => {
    const originalNodeEnv = process.env.NODE_ENV;
    afterEach(() => {
      process.env.NODE_ENV = originalNodeEnv;
    });

    it("production: __Host- prefix, HttpOnly, Secure, SameSite=Lax, Path=/, Max-Age, no Domain, Cache-Control: no-store", async () => {
      process.env.NODE_ENV = "production";
      const res = await start(userA);
      expect(res.statusCode).toBe(200);
      const setCookie = String(res.headers["set-cookie"]);
      expect(setCookie).toMatch(
        new RegExp(`^__Host-mcp_oauth_${GMAIL}=${ONE_TIME_VALUE}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${STATE_TTL_SECONDS}; Secure$`),
      );
      markers.push(setCookie.slice(setCookie.indexOf("=") + 1, setCookie.indexOf(";")));
      expect(res.headers["cache-control"]).toBe("no-store");
    });

    it("production: the flow completes with the __Host- cookie and the reply clears it with Secure", async () => {
      process.env.NODE_ENV = "production";
      const flow = await startFlow(userA);
      expect(flow.name).toBe(`__Host-mcp_oauth_${GMAIL}`);
      const res = await callback(flow.state, flow.cookie);
      expect(oauthResult(res)).toBe("success");
      expect(res.headers["set-cookie"]).toBe(`${flow.name}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0; Secure`);
    });

    it("plain-http localhost (not production): no __Host- prefix and no Secure, still Cache-Control: no-store", async () => {
      process.env.NODE_ENV = "test";
      const res = await start(userA);
      expect(res.statusCode).toBe(200);
      const setCookie = String(res.headers["set-cookie"]);
      expect(setCookie).toMatch(
        new RegExp(`^mcp_oauth_${GMAIL}=${ONE_TIME_VALUE}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${STATE_TTL_SECONDS}$`),
      );
      markers.push(setCookie.slice(setCookie.indexOf("=") + 1, setCookie.indexOf(";")));
      expect(res.headers["cache-control"]).toBe("no-store");
    });
  });

  it("AC 7: flows started for two providers in one browser both complete (one cookie per provider)", async () => {
    const gmail = await startFlow(userA, GMAIL);
    const github = await startFlow(userA, GITHUB);
    expect(gmail.name).not.toBe(github.name);
    const browserCookies = `${gmail.cookie}; ${github.cookie}`;
    const gmailReply = await callback(gmail.state, browserCookies);
    expect(oauthResult(gmailReply)).toBe("success");
    expectCleared(gmailReply, gmail.name);
    const githubReply = await callback(github.state, browserCookies);
    expect(oauthResult(githubReply)).toBe("success");
    expectCleared(githubReply, github.name);
    const rows = await credentials();
    expect(rows.map((c) => c.provider).sort()).toEqual([GITHUB, GMAIL]);
    expect(rows.every((c) => c.userId === userA.id)).toBe(true);
  });

  describe("the reply clears the cookie on failure paths", () => {
    it("the provider sends the browser back without a code (consent denied)", async () => {
      const flow = await startFlow(userA);
      const res = await callback(flow.state, flow.cookie, "");
      expect(oauthResult(res)).toBe("error");
      expectCleared(res, flow.name);
    });

    it("a state whose signature does not match", async () => {
      const flow = await startFlow(userA);
      const res = await callback(`${flow.state}x`, flow.cookie);
      expect(oauthResult(res)).toBe("error");
      expectCleared(res, flow.name);
      expect(await credentials()).toEqual([]);
    });

    it("the provider's code exchange fails", async () => {
      const flow = await startFlow(userA);
      fetchStatus = 400;
      const res = await callback(flow.state, flow.cookie);
      expect(oauthResult(res)).toBe("error");
      expectCleared(res, flow.name);
      expect(await credentials()).toEqual([]);
    });
  });

  it("a provider id that cannot be a cookie name starts no flow", async () => {
    const res = await start(userA, encodeURIComponent("github; Domain=evil.test"));
    expect(res.statusCode).toBe(400);
    expect(res.headers["set-cookie"]).toBeUndefined();
    expect(await stateRowCount()).toBe(0);
  });

  it.each([
    ["unset", undefined, STATE_TTL_SECONDS],
    ["0", "0", STATE_TTL_SECONDS],
    ["negative", "-5", STATE_TTL_SECONDS],
    ["not a number", "ten", STATE_TTL_SECONDS],
    ["not whole", "1.5", STATE_TTL_SECONDS],
    ["120", "120", 120],
  ])("the cookie lives as long as the state: MCP_OAUTH_STATE_TTL_SECONDS %s (%p) gives Max-Age %p", async (_label, ttl, expected) => {
    const service = new McpUserService(
      new ConfigService({ ...CONFIG, MCP_OAUTH_STATE_TTL_SECONDS: ttl }),
      prisma,
      moduleRef.get(McpOAuthStateRepository),
      moduleRef.get(WorkspaceService),
    );
    const { oneTimeValue, maxAgeSeconds } = await service.startOAuthFlow(userA.id, workspaceId, GMAIL);
    markers.push(oneTimeValue);
    expect(maxAgeSeconds).toBe(expected);
  });
});
