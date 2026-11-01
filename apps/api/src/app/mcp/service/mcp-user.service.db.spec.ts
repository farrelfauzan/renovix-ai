import { Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { TestingModule } from "@nestjs/testing";
import { McpUserService } from "./mcp-user.service";
import { WorkspaceService } from "../../workspace/service/workspace.service";
import { WorkspaceQuotaService } from "../../workspace/service/workspace-quota.service";
import { PrismaService } from "../../prisma/prisma.service";
import { createTestModule } from "../../../../test/test-module";
import { resetDatabase } from "../../../../test/test-database";
import { createUser, createWorkspace } from "../../../../test/factories";

// RNX-140 (tests first): the credential lookups an agent run uses (AgentToolService calls
// getUserConnectedProviders; web search calls resolveCredentials), written against the service before its
// queries move into a repository. Only the given user's connected credentials of the given workspace are
// decrypted; another user's, another workspace's or an expired one is never returned; no planted secret
// reaches a log line. Real service, test database.
const OWNER_NOTION = "rnx140-marker-agent-owner-notion";
const OWNER_GITHUB = "rnx140-marker-agent-owner-github";
const OWNER_OTHER_WS = "rnx140-marker-agent-owner-other-workspace";
const MEMBER_SLACK = "rnx140-marker-agent-member-slack";
const SECRETS = [OWNER_NOTION, OWNER_GITHUB, OWNER_OTHER_WS, MEMBER_SLACK];

describe("RNX-140: McpUserService credential lookups for an agent run (test database)", () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let service: McpUserService;
  let ownerId: string;
  let memberId: string;
  let workspaceId: string;
  let otherWorkspaceId: string;
  let logLines: string[];

  beforeAll(async () => {
    ({ moduleRef, prisma } = await createTestModule({
      providers: [McpUserService, WorkspaceService, WorkspaceQuotaService, { provide: ConfigService, useValue: new ConfigService({}) }],
    }));
    service = moduleRef.get(McpUserService);
  });

  beforeEach(async () => {
    await resetDatabase(prisma);
    ownerId = (await createUser(prisma)).id;
    memberId = (await createUser(prisma)).id;
    workspaceId = (await createWorkspace(prisma, { ownerId })).id;
    otherWorkspaceId = (await createWorkspace(prisma, { ownerId })).id;
    logLines = [];
    const record = (...args: unknown[]): void => {
      logLines.push(args.map((a) => (typeof a === "string" ? a : JSON.stringify(a) ?? String(a))).join(" "));
    };
    for (const level of ["log", "error", "warn", "debug", "verbose", "fatal"] as const) {
      jest.spyOn(Logger.prototype, level).mockImplementation((...args: unknown[]) => record(...args));
    }
    for (const level of ["log", "error", "warn", "info", "debug"] as const) {
      jest.spyOn(console, level).mockImplementation((...args: unknown[]) => record(...args));
    }
    await service.connectWithToken(ownerId, workspaceId, "notion", { NOTION_TOKEN: OWNER_NOTION });
    await service.connectWithToken(ownerId, workspaceId, "github", { GITHUB_PERSONAL_ACCESS_TOKEN: OWNER_GITHUB });
    await prisma.userMcpCredential.updateMany({ where: { userId: ownerId, provider: "github" }, data: { status: "expired" } });
    await service.connectWithToken(ownerId, otherWorkspaceId, "linear", { LINEAR_API_KEY: OWNER_OTHER_WS });
    await service.connectWithToken(memberId, workspaceId, "slack", { SLACK_BOT_TOKEN: MEMBER_SLACK });
  });

  // No planted secret reaches a log line, in any test of this file.
  afterEach(() => {
    const leaked = SECRETS.filter((secret) => logLines.some((line) => line.includes(secret)));
    jest.restoreAllMocks();
    expect(leaked).toEqual([]);
  });

  afterAll(() => moduleRef?.close());

  it("getUserConnectedProviders: only the user's connected credentials of that workspace, decrypted", async () => {
    const providers = await service.getUserConnectedProviders(ownerId, workspaceId);

    expect(Object.fromEntries(providers)).toEqual({ notion: { NOTION_TOKEN: OWNER_NOTION } });
  });

  it("getUserConnectedProviders: another user's credentials are not used", async () => {
    const providers = await service.getUserConnectedProviders(memberId, workspaceId);

    expect(Object.fromEntries(providers)).toEqual({ slack: { SLACK_BOT_TOKEN: MEMBER_SLACK } });
  });

  it("getUserConnectedProviders: another workspace's credentials are not used", async () => {
    const providers = await service.getUserConnectedProviders(ownerId, otherWorkspaceId);

    expect(Object.fromEntries(providers)).toEqual({ linear: { LINEAR_API_KEY: OWNER_OTHER_WS } });
  });

  it.each([
    ["the user's own connected credential", () => [ownerId, workspaceId, "notion"], { NOTION_TOKEN: OWNER_NOTION }],
    ["an expired credential", () => [ownerId, workspaceId, "github"], null],
    ["another user's credential", () => [memberId, workspaceId, "notion"], null],
    ["another workspace's credential", () => [ownerId, otherWorkspaceId, "notion"], null],
  ])("resolveCredentials: %s", async (_case, args, expected) => {
    const [userId, wsId, provider] = args();

    await expect(service.resolveCredentials(userId, wsId, provider)).resolves.toEqual(expected);
  });
});
