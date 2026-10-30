import { Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { TestingModule } from "@nestjs/testing";
import { NestFastifyApplication } from "@nestjs/platform-fastify";
import { McpUserController } from "./mcp-user.controller";
import { McpUserService } from "../service/mcp-user.service";
import { PrismaService } from "../../prisma/prisma.service";
import { WorkspaceService } from "../../workspace/service/workspace.service";
import { WorkspaceQuotaService } from "../../workspace/service/workspace-quota.service";
import { ensureDefaultWorkspace } from "../../workspace/repository/ensure-default-workspace";
import { createFastifyApp, createTestModule } from "../../../../test/test-module";
import { resetDatabase } from "../../../../test/test-database";
import { createPackageSnapshot, createPlan, createSubscription, createUser, createWorkspace } from "../../../../test/factories";
import { withdrawCollaboration } from "../../../../test/withdraw-collaboration";
import { asSessionUser } from "../../../../test/as-session-user";

// RX-151: the public OAuth callback stores a provider credential only for a state the server signed,
// that has not expired, is used once, and whose user is still a member of its workspace. The provider
// token exchange (global fetch) is mocked: no provider is called. RX-152: each callback here is sent with
// the cookie the start response set for the one-time value its state carries (the starting browser), so
// these tests still exercise the state checks and not the cookie check (that is mcp-user.oauth-cookie.spec.ts).
// RNX-206: start and callback check the workspace with WorkspaceService.requireMembership (a member row,
// the collaboration rule of RX-113, the default-workspace 404 of RNX-117). So the owner has its owner member
// row (as WorkspaceService.create makes it) and is on the Enterprise plan, which lets `member` use W.
const STATE_SECRET = "rx151-marker-state-secret-not-a-real-secret";
const PROVIDER = "google-gmail";
const CHAT_APP_URL = "http://chat.test.local";
const CONFIG = {
  GOOGLE_OAUTH_CLIENT_ID: "rx151-google-client-id",
  GOOGLE_OAUTH_CLIENT_SECRET: "rx151-marker-google-client-secret",
  GOOGLE_OAUTH_REDIRECT_URI: "http://api.test.local/mcp/user/oauth/callback",
  CHAT_APP_URL,
};
const STATE_TTL_SECONDS = 600;

type Actor = { id: string; email: string };

const decodePart = (part: string): Record<string, unknown> => JSON.parse(Buffer.from(part, "base64url").toString("utf8"));
const encodePart = (value: unknown): string => Buffer.from(JSON.stringify(value)).toString("base64url");

/** Rewrites the JSON payload part of a state, keeping whatever follows it (the signature) unchanged. */
const editPayload = (state: string, edit: (json: string) => string): string => {
  const [payload, ...rest] = state.split(".");
  const json = Buffer.from(payload, "base64url").toString("utf8");
  return [Buffer.from(edit(json)).toString("base64url"), ...rest].join(".");
};

describe("MCP OAuth callback state (RX-151, Fastify, test database)", () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let app: NestFastifyApplication;
  let owner: Actor;
  let member: Actor;
  let otherOwner: Actor;
  let workspaceId: string;
  let otherWorkspaceId: string;
  let codeCount = 0;
  let tokenCount = 0;
  let markers: string[] = [];
  let logLines: string[] = [];
  /** RX-152: the `name=value` cookie each start response set, by its one-time value. */
  let issuedCookies = new Map<string, string>();

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
    owner = await createUser(prisma);
    member = await createUser(prisma);
    otherOwner = await createUser(prisma);
    workspaceId = (await createWorkspace(prisma, { ownerId: owner.id })).id;
    otherWorkspaceId = (await createWorkspace(prisma, { ownerId: otherOwner.id })).id;
    await prisma.workspaceMember.createMany({
      data: [
        { workspaceId, userId: owner.id, role: "owner", status: "active", joinedAt: new Date() },
        { workspaceId, userId: member.id, role: "member", status: "active", joinedAt: new Date() },
      ],
    });
    const enterprise = await createPlan(prisma, { slug: "enterprise" });
    await createSubscription(prisma, { userId: owner.id, planId: enterprise.id });
    // RNX-76 B3 (D297): collaboration comes from the owner's package snapshot, not the plan.
    await createPackageSnapshot(prisma, { userId: owner.id, collaborationEnabled: true });
    markers = [STATE_SECRET, CONFIG.GOOGLE_OAUTH_CLIENT_SECRET];
    logLines = [];
    issuedCookies = new Map();
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
      tokenCount += 1;
      const accessToken = `rx151-marker-access-token-${tokenCount}`;
      const refreshToken = `rx151-marker-refresh-token-${tokenCount}`;
      markers.push(accessToken, refreshToken);
      const body = { access_token: accessToken, refresh_token: refreshToken, token_type: "Bearer", expires_in: 3600, scope: "x" };
      return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
    });
  });

  // AC 9: no state, code, token or secret reaches a log line, in any of these tests.
  afterEach(() => {
    const leaked = markers.filter((marker) => logLines.some((line) => line.includes(marker)));
    jest.restoreAllMocks();
    expect(leaked).toEqual([]);
  });

  afterAll(() => app?.close());

  const auth = (user: Actor) => asSessionUser(user);

  const start = (user: Actor, wsId: string = workspaceId) =>
    app.inject({
      method: "GET",
      url: `/mcp/user/oauth/start?provider=${PROVIDER}&workspaceId=${wsId}`,
      headers: auth(user),
    });

  /** Starts a flow and returns the state of the consent URL. */
  const startFlow = async (user: Actor, wsId: string = workspaceId): Promise<string> => {
    const res = await start(user, wsId);
    expect(res.statusCode).toBe(200);
    const state = new URL(res.json().authUrl).searchParams.get("state");
    expect(state).toBeTruthy();
    markers.push(state!);
    const [cookie] = String(res.headers["set-cookie"]).split(";");
    const value = cookie.slice(cookie.indexOf("=") + 1);
    markers.push(value);
    issuedCookies.set(value, cookie);
    return state!;
  };

  /** The cookie set for the one-time value the state carries, if any (read without verifying the state). */
  const cookieFor = (state: string): Record<string, string> => {
    try {
      const cookie = issuedCookies.get(String(decodePart(state.split(".")[0]).n));
      return cookie ? { cookie } : {};
    } catch {
      return {};
    }
  };

  const callback = (state: string) => {
    codeCount += 1;
    const code = `rx151-marker-code-${codeCount}`;
    markers.push(code, state);
    return app.inject({
      method: "GET",
      url: `/mcp/user/oauth/callback?code=${encodeURIComponent(code)}&state=${encodeURIComponent(state)}`,
      headers: cookieFor(state),
    });
  };

  const oauthResult = (res: { statusCode: number; headers: Record<string, unknown> }) => {
    expect(res.statusCode).toBe(302);
    const location = String(res.headers.location);
    expect(location.startsWith(`${CHAT_APP_URL}/agents`)).toBe(true);
    for (const marker of markers) expect(location).not.toContain(marker);
    return new URL(location).searchParams.get("oauth");
  };

  /** The refusal message the callback's error redirect carries. */
  const redirectMessage = (res: { headers: Record<string, unknown> }) =>
    new URL(String(res.headers.location)).searchParams.get("message");

  const credentials = () => prisma.userMcpCredential.findMany();
  const stateRowCount = async (): Promise<number> => {
    const [{ n }] = await prisma.$queryRawUnsafe<{ n: number }[]>("SELECT count(*)::int AS n FROM mcp_oauth_states");
    return n;
  };

  it("AC 7: a valid, fresh, unused state stores the credential for the user and workspace that started", async () => {
    const state = await startFlow(owner);
    expect(oauthResult(await callback(state))).toBe("success");
    const rows = await credentials();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ userId: owner.id, workspaceId, provider: PROVIDER, status: "connected" });
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
  });

  it("AC 1: a state in the old unsigned format stores nothing", async () => {
    const unsigned = encodePart({ userId: owner.id, workspaceId, provider: PROVIDER });
    expect(oauthResult(await callback(unsigned))).toBe("error");
    expect(await credentials()).toEqual([]);
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it("AC 2: a signed state whose user id was changed afterwards is refused", async () => {
    const state = await startFlow(owner);
    const forged = editPayload(state, (json) => json.replaceAll(owner.id, member.id));
    expect(oauthResult(await callback(forged))).toBe("error");
    expect(await credentials()).toEqual([]);
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it("AC 2: a signed state whose workspace id was changed afterwards is refused", async () => {
    const state = await startFlow(owner);
    const forged = editPayload(state, (json) => json.replaceAll(workspaceId, otherWorkspaceId));
    expect(oauthResult(await callback(forged))).toBe("error");
    expect(await credentials()).toEqual([]);
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it("AC 3: A's state carrying B's ids, while B has a flow of its own, stores nothing for B", async () => {
    const stateA = await startFlow(owner);
    await startFlow(member);
    const forged = editPayload(stateA, (json) => json.replaceAll(owner.id, member.id));
    expect(oauthResult(await callback(forged))).toBe("error");
    expect(await credentials()).toEqual([]);
    // A's own state is untouched by the attempt and stores only for A.
    expect(oauthResult(await callback(stateA))).toBe("success");
    expect((await credentials()).map((c) => c.userId)).toEqual([owner.id]);
  });

  it("AC 3: A's one-time value and signature on a state naming B are refused", async () => {
    const stateA = await startFlow(owner);
    const stateB = await startFlow(member);
    const [payloadA, signatureA] = stateA.split(".");
    const [payloadB] = stateB.split(".");
    const forged = [encodePart({ ...decodePart(payloadB), n: decodePart(payloadA).n }), signatureA]
      .filter(Boolean)
      .join(".");
    expect(oauthResult(await callback(forged))).toBe("error");
    expect(await credentials()).toEqual([]);
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it("AC 4: a valid state older than its expiry is refused", async () => {
    const state = await startFlow(owner);
    const later = Date.now() + (STATE_TTL_SECONDS + 60) * 1000;
    jest.spyOn(Date, "now").mockReturnValue(later);
    expect(oauthResult(await callback(state))).toBe("error");
    expect(await credentials()).toEqual([]);
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it("AC 5: a state already used once is refused and the stored credential stays unchanged", async () => {
    const state = await startFlow(owner);
    expect(oauthResult(await callback(state))).toBe("success");
    const [before] = await credentials();
    expect(oauthResult(await callback(state))).toBe("error");
    const after = await credentials();
    expect(after).toHaveLength(1);
    expect(after[0].envEncrypted).toBe(before.envEncrypted);
    expect(after[0].connectedAt).toEqual(before.connectedAt);
    expect(after[0].updatedAt).toEqual(before.updatedAt);
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
  });

  it("AC 6: a member of the Enterprise owner's workspace removed after starting is refused", async () => {
    const state = await startFlow(member);
    await prisma.workspaceMember.updateMany({ where: { workspaceId, userId: member.id }, data: { status: "removed" } });
    const res = await callback(state);
    expect(oauthResult(res)).toBe("error");
    // RNX-206 AC 3: refused by WorkspaceService.requireMembership (its 403 message), not the old helper.
    expect(redirectMessage(res)).toBe("Not a member of this workspace");
    expect(await credentials()).toEqual([]);
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  describe("RNX-206: the workspace check of WorkspaceService.requireMembership", () => {
    /**
     * Moves W's owner to a plan without collaboration (slug `slug`, not "enterprise"); RNX-76 B3 (D297): and their
     * packages no longer enable collaboration, which is what decides it now.
     */
    const moveOwnerToPlan = async (slug: string) => {
      const plan = await createPlan(prisma, { slug });
      await prisma.userSubscription.update({ where: { userId: owner.id }, data: { planId: plan.id } });
      withdrawCollaboration(owner.id);
    };

    const expectStartRefused = async (res: { statusCode: number; body: string; headers: Record<string, unknown> }, status: number, message: string) => {
      expect({ status: res.statusCode, message: JSON.parse(res.body).message }).toEqual({ status, message });
      expect(res.body).not.toContain("authUrl");
      expect(res.headers["set-cookie"]).toBeUndefined();
      expect(await stateRowCount()).toBe(0);
    };

    it("AC 2: a user who is not a member of W cannot start a flow: 403, no auth URL, no cookie, no state", async () => {
      await expectStartRefused(await start(otherOwner), 403, "Not a member of this workspace");
    });

    it.each(["starter", "pro"])(
      "AC 2: an active member of a %s workspace not their own is refused with the collaboration message, no state",
      async (slug) => {
        await moveOwnerToPlan(slug);
        await expectStartRefused(await start(member), 403, "Workspace collaboration requires an Enterprise plan.");
      },
    );

    it("AC 2: the owner's default workspace answers 404 Workspace not found, no state", async () => {
      const defaultWorkspace = await ensureDefaultWorkspace(prisma, owner.id);
      await expectStartRefused(await start(owner, defaultWorkspace.id), 404, "Workspace not found");
    });

    it("AC 3: started while allowed, W's owner now on a plan without collaboration: error, no code exchange, nothing stored", async () => {
      const state = await startFlow(member);
      await moveOwnerToPlan("starter");
      const res = await callback(state);
      expect(oauthResult(res)).toBe("error");
      expect(redirectMessage(res)).toBe("Workspace collaboration requires an Enterprise plan.");
      expect(await credentials()).toEqual([]);
      expect(globalThis.fetch).not.toHaveBeenCalled();
    });

    it("AC 3: started while allowed, W is now a default workspace: error, no code exchange, nothing stored", async () => {
      const state = await startFlow(owner);
      await prisma.workspace.update({ where: { id: workspaceId }, data: { isDefault: true } });
      const res = await callback(state);
      expect(oauthResult(res)).toBe("error");
      expect(redirectMessage(res)).toBe("Workspace not found");
      expect(await credentials()).toEqual([]);
      expect(globalThis.fetch).not.toHaveBeenCalled();
    });

    it("AC 7 (control): a member of the Enterprise owner's workspace completes the flow", async () => {
      const state = await startFlow(member);
      expect(oauthResult(await callback(state))).toBe("success");
      expect((await credentials()).map((c) => ({ userId: c.userId, workspaceId: c.workspaceId }))).toEqual([{ userId: member.id, workspaceId }]);
      expect(globalThis.fetch).toHaveBeenCalledTimes(1);
    });
  });

  it.each([
    ["missing", undefined],
    ["empty", ""],
  ])("AC 8: with the signing secret %s, starting a flow is refused and no state is issued", async (_label, value) => {
    if (value === undefined) delete process.env.MCP_OAUTH_STATE_SECRET;
    else process.env.MCP_OAUTH_STATE_SECRET = value;
    const res = await start(owner);
    expect(res.statusCode).toBeGreaterThanOrEqual(400);
    expect(res.body).not.toContain("authUrl");
    expect(res.body).not.toContain("state=");
    expect(await stateRowCount()).toBe(0);
  });

  it("AC 8: with the signing secret gone at the callback, nothing is stored", async () => {
    const state = await startFlow(owner);
    delete process.env.MCP_OAUTH_STATE_SECRET;
    expect(oauthResult(await callback(state))).toBe("error");
    expect(await credentials()).toEqual([]);
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });
});
