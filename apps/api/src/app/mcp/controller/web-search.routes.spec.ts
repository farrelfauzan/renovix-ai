import { Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { TestingModule } from "@nestjs/testing";
import { NestFastifyApplication } from "@nestjs/platform-fastify";
import { createDecipheriv } from "node:crypto";
import { WebSearchController } from "./web-search.controller";
import { WebSearchService } from "../service/web-search.service";
import { McpUserService } from "../service/mcp-user.service";
import { WorkspaceService } from "../../workspace/service/workspace.service";
import { WorkspaceQuotaService } from "../../workspace/service/workspace-quota.service";
import { PrismaService } from "../../prisma/prisma.service";
import { createFastifyApp, createTestModule } from "../../../../test/test-module";
import { resetDatabase } from "../../../../test/test-database";
import { createPackageSnapshot, createUser, createWorkspace } from "../../../../test/factories";
import { asSessionUser } from "../../../../test/as-session-user";

// RNX-140 (tests first): the web search key, status and policy routes and the search an agent runs, written
// against the services before their queries move into repositories. Real WebSearchService, McpUserService and
// test database; every Brave and DuckDuckGo call is a mocked global fetch (no third party is called). The Brave
// key is stored as the MCP credential `web-search-brave` (iv:tag:data, AES-256-GCM, hex), the policy and the daily
// usage as app_configs rows; another user's key is never shown, used or deleted; no planted key reaches a log line
// or a response.
const OWNER_KEY = "rnx140-marker-owner-brave-key-0001";
const MEMBER_KEY = "rnx140-marker-member-brave-key-0002";
const BRAVE_CREDENTIAL = "web-search-brave";
const STORED_FORM = /^[0-9a-f]{32}:[0-9a-f]{32}:[0-9a-f]+$/;

type Actor = { id: string; email: string };
type FetchCall = { url: string; token: string | null };

/** Reads a stored credential as AES-256-GCM `iv:tag:data` (hex) under the test key (setup-env.ts). */
const decryptStored = (stored: string): unknown => {
  const [iv, tag, data] = stored.split(":");
  const key = Buffer.from(process.env.MCP_ENCRYPTION_KEY as string, "hex");
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(iv, "hex"));
  decipher.setAuthTag(Buffer.from(tag, "hex"));
  return JSON.parse(decipher.update(data, "hex", "utf8") + decipher.final("utf8"));
};

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

describe("RNX-140: web search routes and search (Fastify, test database, mocked fetch)", () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let app: NestFastifyApplication;
  let webSearch: WebSearchService;
  let owner: Actor;
  let member: Actor;
  let workspaceId: string;
  let logLines: string[];
  let responseBodies: string[];
  let fetchCalls: FetchCall[];
  let braveStatus: number;

  beforeAll(async () => {
    ({ moduleRef, prisma } = await createTestModule({
      controllers: [WebSearchController],
      providers: [
        WebSearchService,
        McpUserService,
        WorkspaceService,
        WorkspaceQuotaService,
        { provide: ConfigService, useValue: new ConfigService({}) },
      ],
    }));
    app = await createFastifyApp(moduleRef);
    webSearch = moduleRef.get(WebSearchService);
  });

  beforeEach(async () => {
    await resetDatabase(prisma);
    owner = await createUser(prisma);
    member = await createUser(prisma);
    workspaceId = (await createWorkspace(prisma, { ownerId: owner.id })).id;
    await prisma.workspaceMember.createMany({
      data: [
        { workspaceId, userId: owner.id, role: "owner", status: "active", joinedAt: new Date() },
        { workspaceId, userId: member.id, role: "member", status: "active", joinedAt: new Date() },
      ],
    });
    // RNX-76 B3 (D297): collaboration comes from the owner's package snapshot, so `member` may use the workspace.
    await createPackageSnapshot(prisma, { userId: owner.id, collaborationEnabled: true });
    logLines = [];
    responseBodies = [];
    fetchCalls = [];
    braveStatus = 200;
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
      const token = new Headers(init?.headers).get("X-Subscription-Token");
      fetchCalls.push({ url, token });
      if (url.startsWith("https://api.search.brave.com/")) {
        if (braveStatus !== 200) return new Response("rnx140 brave refused", { status: braveStatus });
        const query = new URL(url).searchParams.get("q");
        return json({ web: { results: [{ title: `Brave ${query}`, url: "https://example.test/a", description: "brave snippet" }] } });
      }
      return json({ Heading: "DDG", AbstractURL: "https://example.test/ddg", AbstractText: "ddg snippet", RelatedTopics: [] });
    });
  });

  // No planted key reaches a log line or a response body, in any test of this file.
  afterEach(() => {
    const leaked = [OWNER_KEY, MEMBER_KEY].filter((key) => [...logLines, ...responseBodies].some((line) => line.includes(key)));
    jest.restoreAllMocks();
    expect(leaked).toEqual([]);
  });

  afterAll(() => app?.close());

  const send = async (actor: Actor, method: "GET" | "PUT" | "DELETE", url: string, payload?: object) => {
    const res = await app.inject({ method, url, headers: asSessionUser(actor), payload });
    responseBodies.push(res.body);
    return res;
  };

  const putKey = (actor: Actor, apiKey: string) => send(actor, "PUT", "/integrations/web-search/brave/key", { workspaceId, apiKey });

  const credentials = () => prisma.userMcpCredential.findMany({ orderBy: { id: "asc" } });

  const appConfig = () => prisma.appConfig.findMany({ orderBy: { key: "asc" } });

  const usageKey = (userId: string) => `web_search_usage:${workspaceId}:${userId}:${new Date().toISOString().slice(0, 10)}`;

  /** Runs a search as an agent's web_search tool does, keeping its answer for the leak check. */
  const search = async (userId: string, query: string, maxResults?: number) => {
    const answer = await webSearch.search(userId, workspaceId, query, maxResults);
    responseBodies.push(answer);
    return answer;
  };

  describe("connect: PUT /integrations/web-search/brave/key", () => {
    it("validates the key with Brave, stores it as the caller's encrypted credential, answers the masked key", async () => {
      const res = await putKey(owner, OWNER_KEY);

      expect({ status: res.statusCode, body: res.json() }).toEqual({
        status: 200,
        body: { connected: true, provider: "brave-search", maskedKey: "rnx1****001" },
      });
      expect(fetchCalls).toEqual([{ url: "https://api.search.brave.com/res/v1/web/search?q=validation&count=1", token: OWNER_KEY }]);
      const [row, ...others] = await credentials();
      expect(others).toEqual([]);
      expect(row).toMatchObject({ userId: owner.id, workspaceId, provider: BRAVE_CREDENTIAL, status: "connected" });
      expect(row.envEncrypted).toMatch(STORED_FORM);
      expect(decryptStored(row.envEncrypted)).toEqual({ BRAVE_API_KEY: OWNER_KEY });
    });

    it("error path: a key Brave refuses is a 400 and nothing is stored", async () => {
      braveStatus = 401;

      const res = await putKey(owner, OWNER_KEY);

      expect({ status: res.statusCode, message: res.json().message }).toEqual({
        status: 400,
        message: "Invalid Brave API key or provider rejected validation",
      });
      expect(await credentials()).toEqual([]);
    });
  });

  describe("read: GET /integrations/web-search/status", () => {
    it("shows the caller's own key masked, the default policy and the providers", async () => {
      await putKey(owner, OWNER_KEY);

      const res = await send(owner, "GET", `/integrations/web-search/status?workspaceId=${workspaceId}`);

      expect({ status: res.statusCode, body: res.json() }).toEqual({
        status: 200,
        body: {
          connected: true,
          provider: "brave-search",
          maskedKey: "rnx1****001",
          policy: { allowedProviders: ["brave-search"], preferredProvider: "brave-search", maxResults: 5, dailyLimitPerUser: 100 },
          supportedProviders: ["brave-search", "duckduckgo"],
        },
      });
    });

    it("another user's key is not read: the member of the same workspace sees not connected", async () => {
      await putKey(owner, OWNER_KEY);

      const res = await send(member, "GET", `/integrations/web-search/status?workspaceId=${workspaceId}`);

      expect(res.json()).toMatchObject({ connected: false, maskedKey: null });
    });
  });

  describe("disconnect: DELETE /integrations/web-search/brave/key", () => {
    it("removes the caller's key (answering the credential's provider); a second call answers as for no key", async () => {
      await putKey(owner, OWNER_KEY);

      const first = await send(owner, "DELETE", `/integrations/web-search/brave/key?workspaceId=${workspaceId}`);
      const second = await send(owner, "DELETE", `/integrations/web-search/brave/key?workspaceId=${workspaceId}`);

      expect([first, second].map((res) => ({ status: res.statusCode, body: res.json() }))).toEqual([
        { status: 200, body: { disconnected: true, provider: BRAVE_CREDENTIAL } },
        { status: 200, body: { disconnected: true, provider: "brave-search" } },
      ]);
      expect(await credentials()).toEqual([]);
    });

    it("another user's key is not deleted: the member's call answers as for no key, the owner's row stays", async () => {
      await putKey(owner, OWNER_KEY);
      const before = await credentials();

      const res = await send(member, "DELETE", `/integrations/web-search/brave/key?workspaceId=${workspaceId}`);

      expect({ status: res.statusCode, body: res.json() }).toEqual({ status: 200, body: { disconnected: true, provider: "brave-search" } });
      expect(await credentials()).toEqual(before);
    });
  });

  describe("policy: GET and PUT /integrations/web-search/policy", () => {
    it("PUT stores the merged policy as JSON in app_configs under the workspace's key; GET reads it back", async () => {
      const put = await send(owner, "PUT", "/integrations/web-search/policy", { workspaceId, allowedProviders: ["duckduckgo", "brave-search"], preferredProvider: "duckduckgo", maxResults: 3 });
      const get = await send(member, "GET", `/integrations/web-search/policy?workspaceId=${workspaceId}`);

      const expected = { allowedProviders: ["duckduckgo", "brave-search"], preferredProvider: "duckduckgo", maxResults: 3, dailyLimitPerUser: 100 };
      expect({ status: put.statusCode, body: put.json() }).toEqual({ status: 200, body: expected });
      expect({ status: get.statusCode, body: get.json() }).toEqual({ status: 200, body: expected });
      expect(await appConfig()).toEqual([{ id: expect.any(String), key: `web_search_policy:${workspaceId}`, value: JSON.stringify(expected) }]);
    });

    it("a second PUT updates the same row", async () => {
      await send(owner, "PUT", "/integrations/web-search/policy", { workspaceId, maxResults: 3 });
      const [first] = await appConfig();

      await send(owner, "PUT", "/integrations/web-search/policy", { workspaceId, dailyLimitPerUser: 7 });

      const expected = { allowedProviders: ["brave-search"], preferredProvider: "brave-search", maxResults: 3, dailyLimitPerUser: 7 };
      expect(await appConfig()).toEqual([{ id: first.id, key: first.key, value: JSON.stringify(expected) }]);
    });
  });

  describe("use by an agent: WebSearchService.search", () => {
    it("searches Brave with the caller's own key and counts the use in app_configs per user and day", async () => {
      await putKey(owner, OWNER_KEY);
      fetchCalls = [];

      const first = await search(owner.id, "rnx140 first");
      await search(owner.id, "rnx140 second");

      expect(first).toContain('Top web results for "rnx140 first" via brave-search:');
      expect(fetchCalls.map((call) => call.token)).toEqual([OWNER_KEY, OWNER_KEY]);
      expect(await appConfig()).toEqual([{ id: expect.any(String), key: usageKey(owner.id), value: "2" }]);
    });

    it("refuses once the user's daily limit is used up, without calling a provider", async () => {
      await putKey(owner, OWNER_KEY);
      await send(owner, "PUT", "/integrations/web-search/policy", { workspaceId, dailyLimitPerUser: 1 });
      await search(owner.id, "rnx140 within limit");
      fetchCalls = [];

      await expect(search(owner.id, "rnx140 over limit")).rejects.toThrow("Web search daily limit reached (1/day).");
      expect(fetchCalls).toEqual([]);
    });

    it("another user's key is not used: the member without a key is told to connect one, no Brave call carries a key", async () => {
      await putKey(owner, OWNER_KEY);
      fetchCalls = [];

      const answer = await search(member.id, "rnx140 member query");

      expect(answer).toBe('Web search is not configured for this user. Please connect your Brave API key in Integrations settings. Query: "rnx140 member query"');
      expect(fetchCalls).toEqual([]);
      expect((await appConfig()).map((row) => row.key)).not.toContain(usageKey(member.id));
    });

    it("error path: a Brave failure is reported without the key and nothing is counted", async () => {
      await putKey(owner, OWNER_KEY);
      braveStatus = 500;

      const answer = await search(owner.id, "rnx140 brave down");

      expect(answer).toBe('Web search could not retrieve results for "rnx140 brave down". Provider attempts: brave-search: Brave search failed (500)');
      expect(logLines.some((line) => line.includes("Brave search failed (500)"))).toBe(true);
      expect(await appConfig()).toEqual([]);
    });
  });
});
