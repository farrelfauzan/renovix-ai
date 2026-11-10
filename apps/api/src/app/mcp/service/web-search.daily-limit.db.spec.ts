import { ConfigService } from "@nestjs/config";
import { TestingModule } from "@nestjs/testing";
import { WebSearchService } from "./web-search.service";
import { McpUserService } from "./mcp-user.service";
import { WorkspaceService } from "../../workspace/service/workspace.service";
import { WorkspaceQuotaService } from "../../workspace/service/workspace-quota.service";
import { PrismaService } from "../../prisma/prisma.service";
import { createTestModule } from "../../../../test/test-module";
import { resetDatabase } from "../../../../test/test-database";
import { createUser, createWorkspace } from "../../../../test/factories";

// RNX-294 (D314): the daily web search limit is taken in one atomic statement on app_configs, so concurrent
// searches never pass it and never lose a count; a search that finds nothing or fails gives its slot back; cached
// results are served only to the user whose search fetched them. Real WebSearchService, McpUserService and test
// database; every Brave and DuckDuckGo call is a mocked global fetch that waits a little, so concurrent searches
// overlap (no third party is called).
const LIMIT = 3;
const CONCURRENT_SEARCHES = 6;
const PROVIDER_DELAY_MS = 30;
const X_KEY = "rnx294-marker-x-brave-key-000001";
const BRAVE_CREDENTIAL = "web-search-brave";
const LIMIT_MESSAGE = `Web search daily limit reached (${LIMIT}/day).`;

type Outcome = { status: "ok"; answer: string } | { status: "refused"; message: string };

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

describe("RNX-294: web search daily limit is atomic, cached results stay with their user (test database, mocked fetch)", () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let webSearch: WebSearchService;
  let mcpUser: McpUserService;
  let xId: string;
  let yId: string;
  let workspaceId: string;
  let otherWorkspaceId: string;
  let braveCalls: number;
  let braveStatus: number;
  let ddgStatus: number;
  let hasBraveResults: boolean;

  beforeAll(async () => {
    ({ moduleRef, prisma } = await createTestModule({
      providers: [
        WebSearchService,
        McpUserService,
        WorkspaceService,
        WorkspaceQuotaService,
        { provide: ConfigService, useValue: new ConfigService({}) },
      ],
    }));
    webSearch = moduleRef.get(WebSearchService);
    mcpUser = moduleRef.get(McpUserService);
  });

  beforeEach(async () => {
    await resetDatabase(prisma);
    xId = (await createUser(prisma)).id;
    yId = (await createUser(prisma)).id;
    workspaceId = (await createWorkspace(prisma, { ownerId: xId })).id;
    otherWorkspaceId = (await createWorkspace(prisma, { ownerId: xId })).id;
    await prisma.workspaceMember.createMany({
      data: [
        { workspaceId, userId: xId, role: "owner", status: "active", joinedAt: new Date() },
        { workspaceId, userId: yId, role: "member", status: "active", joinedAt: new Date() },
      ],
    });
    await mcpUser.connectWithToken(xId, workspaceId, BRAVE_CREDENTIAL, { BRAVE_API_KEY: X_KEY });
    await webSearch.updatePolicy(workspaceId, { dailyLimitPerUser: LIMIT });
    braveCalls = 0;
    braveStatus = 200;
    ddgStatus = 200;
    hasBraveResults = true;
    jest.spyOn(globalThis, "fetch").mockImplementation(async (input: string | URL | Request) => {
      const url = String(input);
      await new Promise((resolve) => setTimeout(resolve, PROVIDER_DELAY_MS));
      if (url.startsWith("https://api.search.brave.com/")) {
        braveCalls += 1;
        if (braveStatus !== 200) return new Response("rnx294 brave refused", { status: braveStatus });
        const query = new URL(url).searchParams.get("q");
        const results = hasBraveResults ? [{ title: `Brave ${query}`, url: "https://example.test/x", description: "fetched with X's key" }] : [];
        return json({ web: { results } });
      }
      if (ddgStatus !== 200) return new Response("rnx294 ddg refused", { status: ddgStatus });
      return json({ Heading: "DDG", AbstractURL: "", AbstractText: "", RelatedTopics: [] });
    });
  });

  afterEach(() => jest.restoreAllMocks());

  afterAll(() => moduleRef?.close());

  const usageKey = (userId: string, inWorkspaceId = workspaceId) =>
    `web_search_usage:${inWorkspaceId}:${userId}:${new Date().toISOString().slice(0, 10)}`;

  const storedCount = async (userId: string, inWorkspaceId = workspaceId): Promise<string | null> =>
    (await prisma.appConfig.findUnique({ where: { key: usageKey(userId, inWorkspaceId) } }))?.value ?? null;

  const seedCount = (userId: string, value: number, inWorkspaceId = workspaceId) =>
    prisma.appConfig.create({ data: { key: usageKey(userId, inWorkspaceId), value: String(value) } });

  const runSearch = (userId: string, query: string): Promise<Outcome> =>
    webSearch.search(userId, workspaceId, query).then(
      (answer): Outcome => ({ status: "ok", answer }),
      (err: Error): Outcome => ({ status: "refused", message: err.message }),
    );

  const runConcurrently = (userId: string) =>
    Promise.all(Array.from({ length: CONCURRENT_SEARCHES }, (_, i) => runSearch(userId, `rnx294 concurrent ${i}`)));

  it("AC1: at limit - 1, concurrent searches with results: exactly one succeeds, the others get the 400, the count is the limit", async () => {
    await seedCount(xId, LIMIT - 1);

    const outcomes = await runConcurrently(xId);

    expect(outcomes.filter((o) => o.status === "ok")).toHaveLength(1);
    expect(outcomes.filter((o) => o.status === "refused")).toEqual(
      Array.from({ length: CONCURRENT_SEARCHES - 1 }, () => ({ status: "refused", message: LIMIT_MESSAGE })),
    );
    expect(await storedCount(xId)).toBe(String(LIMIT));
  });

  it("AC1: the refusal is a 400", async () => {
    await seedCount(xId, LIMIT);

    await expect(webSearch.search(xId, workspaceId, "rnx294 over")).rejects.toMatchObject({ status: 400, message: LIMIT_MESSAGE });
    expect(braveCalls).toBe(0);
  });

  it("AC2: from 0, concurrent searches below the limit all count: the count is exactly their number", async () => {
    await webSearch.updatePolicy(workspaceId, { dailyLimitPerUser: CONCURRENT_SEARCHES + 1 });

    const outcomes = await runConcurrently(xId);

    expect(outcomes.every((o) => o.status === "ok")).toBe(true);
    expect(await storedCount(xId)).toBe(String(CONCURRENT_SEARCHES));
  });

  it("AC3: a search with no results leaves the count unchanged (from 0: no row; from 1: still 1)", async () => {
    hasBraveResults = false;

    const fromZero = await runSearch(xId, "rnx294 nothing");
    const zeroCount = await storedCount(xId);
    await seedCount(xId, 1);
    await runSearch(xId, "rnx294 nothing again");

    expect(fromZero).toEqual({ status: "ok", answer: 'No relevant web results found for "rnx294 nothing".' });
    expect({ zeroCount, oneCount: await storedCount(xId) }).toEqual({ zeroCount: null, oneCount: "1" });
  });

  it("AC3: a search where every provider fails leaves the count unchanged, and a user at limit - 1 keeps the last slot", async () => {
    await webSearch.updatePolicy(workspaceId, { allowedProviders: ["brave-search", "duckduckgo"] });
    await seedCount(xId, LIMIT - 1);
    braveStatus = 500;
    ddgStatus = 500;

    const failed = await runSearch(xId, "rnx294 all down");
    const afterFailure = await storedCount(xId);
    braveStatus = 200;
    const next = await runSearch(xId, "rnx294 back up");

    expect(failed).toEqual({
      status: "ok",
      answer: 'Web search could not retrieve results for "rnx294 all down". Provider attempts: brave-search: Brave search failed (500) | duckduckgo: DuckDuckGo search failed (500)',
    });
    expect(afterFailure).toBe(String(LIMIT - 1));
    expect(next.status).toBe("ok");
    expect(await storedCount(xId)).toBe(String(LIMIT));
  });

  it("AC3: an error thrown after the slot was taken gives it back", async () => {
    await seedCount(xId, 1);
    jest.spyOn(mcpUser, "resolveCredentials").mockRejectedValue(new Error("rnx294 credential store down"));

    const outcome = await runSearch(xId, "rnx294 throws");

    expect(outcome).toEqual({ status: "refused", message: "rnx294 credential store down" });
    expect(await storedCount(xId)).toBe("1");
  });

  it("AC3: a search served from the cache counts once, as a fetched one does", async () => {
    await runSearch(xId, "rnx294 cached");
    await runSearch(xId, "rnx294 cached");

    expect(braveCalls).toBe(1);
    expect(await storedCount(xId)).toBe("2");
  });

  it("AC4: another user's count and the same user's count in another workspace do not change", async () => {
    await seedCount(xId, LIMIT - 1);
    await seedCount(yId, 1);
    await seedCount(xId, 2, otherWorkspaceId);

    await runConcurrently(xId);

    expect({ y: await storedCount(yId), xElsewhere: await storedCount(xId, otherWorkspaceId), x: await storedCount(xId) }).toEqual({
      y: "1",
      xElsewhere: "2",
      x: String(LIMIT),
    });
  });

  it("AC5: Y (no Brave key) runs the query X's Brave search cached and gets none of X's results (negative test)", async () => {
    const xAnswer = await runSearch(xId, "rnx294 shared query");

    const yAnswer = await runSearch(yId, "rnx294 shared query");

    expect(xAnswer).toEqual({ status: "ok", answer: expect.stringContaining("fetched with X's key") });
    expect(yAnswer).toEqual({
      status: "ok",
      answer: 'Web search is not configured for this user. Please connect your Brave API key in Integrations settings. Query: "rnx294 shared query"',
    });
    expect(braveCalls).toBe(1);
    expect(await storedCount(yId)).toBeNull();
  });
});
