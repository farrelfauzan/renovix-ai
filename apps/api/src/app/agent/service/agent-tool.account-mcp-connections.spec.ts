import { Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { TestingModule } from "@nestjs/testing";
import { AgentToolService } from "./agent-tool.service";
import { AgentMemoryService } from "./agent-memory.service";
import { McpClientService } from "../../mcp/service/mcp-client.service";
import { McpService } from "../../mcp/service/mcp.service";
import { McpRegistryService } from "../../mcp/service/mcp-registry.service";
import { McpUserService } from "../../mcp/service/mcp-user.service";
import { WebSearchService } from "../../mcp/service/web-search.service";
import { DocumentService } from "../../document/service/document.service";
import { WorkspaceService } from "../../workspace/service/workspace.service";
import { WorkspaceQuotaService } from "../../workspace/service/workspace-quota.service";
import { PrismaService } from "../../prisma/prisma.service";
import { createTestModule } from "../../../../test/test-module";
import { resetDatabase } from "../../../../test/test-database";
import { createAgent, createPackageSnapshot, createUser, createWorkspace } from "../../../../test/factories";
import { createMcpRunSession } from "../utils/create-mcp-run-session";

// RNX-292 (D312): what an agent run is offered. A user connects Gmail once and switches it on in workspaces A and B:
// a run by that user in A and in B discovers the Gmail tools with that user's env; in C (not switched on) and for
// another member of A (whose own account has no Gmail) nothing is discovered. Real AgentToolService, McpUserService,
// McpService, McpRegistryService and WorkspaceService on the test database; the MCP client is a stub that records the
// env it was given (no package is started, no network). The modules mocked below load ESM-only packages.
jest.mock("../../mcp/service/web-search.service", () => ({ WebSearchService: class {} }));
jest.mock("./agent-memory.service", () => ({ AgentMemoryService: class {} }));
jest.mock("../../document/service/document.service", () => ({ DocumentService: class {} }));
jest.mock("../../providers/provider-router", () => ({ ProviderRouter: class {} }));

const GMAIL = "google-gmail";
const X_TOKEN = "rnx292-marker-agent-gmail-token-of-x";
const GMAIL_TOOL = "gmail_search";

describe("RNX-292: an agent run is offered the runner's account MCP tools only where they are switched on (test database)", () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let service: AgentToolService;
  let mcpUser: McpUserService;
  let logLines: string[];
  /** The env each stub connection was opened with. */
  const connectedEnvs: Record<string, string>[] = [];
  const mcpClient = {
    connect: jest.fn(async (config: { id: string; env: Record<string, string> }) => {
      connectedEnvs.push(config.env);
      return { serverId: config.id, client: { listTools: async () => ({ tools: [{ name: GMAIL_TOOL, inputSchema: { type: "object" } }] }) }, credentialDir: null };
    }),
    close: jest.fn(async () => undefined),
  };

  beforeAll(async () => {
    ({ moduleRef, prisma } = await createTestModule({
      providers: [
        AgentToolService,
        McpUserService,
        McpService,
        McpRegistryService,
        WorkspaceService,
        WorkspaceQuotaService,
        { provide: ConfigService, useValue: new ConfigService({}) },
        { provide: McpClientService, useValue: mcpClient },
        ...[WebSearchService, AgentMemoryService, DocumentService].map((provide) => ({ provide, useValue: {} })),
      ],
    }));
    service = moduleRef.get(AgentToolService);
    mcpUser = moduleRef.get(McpUserService);
  });

  beforeEach(async () => {
    await resetDatabase(prisma);
    jest.clearAllMocks();
    connectedEnvs.length = 0;
    logLines = [];
    const record = (...args: unknown[]): void => {
      logLines.push(args.map((a) => (typeof a === "string" ? a : JSON.stringify(a) ?? String(a))).join(" "));
    };
    for (const level of ["log", "error", "warn", "debug", "verbose", "fatal"] as const) {
      jest.spyOn(Logger.prototype, level).mockImplementation((...args: unknown[]) => record(...args));
    }
  });

  // AC 11: the token never reaches a log line.
  afterEach(() => {
    const leaked = logLines.filter((line) => line.includes(X_TOKEN));
    jest.restoreAllMocks();
    expect(leaked).toEqual([]);
  });

  afterAll(() => moduleRef?.close());

  /** An Enterprise owner's workspaces A, B and C, each with an agent; x and y active members of each; x's Gmail on in A and B. */
  const seed = async () => {
    const owner = await createUser(prisma);
    await createPackageSnapshot(prisma, { userId: owner.id, collaborationEnabled: true });
    const [x, y] = [await createUser(prisma), await createUser(prisma)];
    const workspaces = [];
    for (const name of ["A", "B", "C"]) {
      const workspace = await createWorkspace(prisma, { ownerId: owner.id, name });
      await prisma.workspaceMember.createMany({
        data: [owner, x, y].map((user) => ({ workspaceId: workspace.id, userId: user.id, role: user === owner ? "owner" : "member", status: "active", joinedAt: new Date() })),
      });
      const agent = await createAgent(prisma, { userId: owner.id, workspaceId: workspace.id });
      workspaces.push({ id: workspace.id, agentId: agent.id });
    }
    const [a, b, c] = workspaces;
    await mcpUser.connectWithToken(x.id, a.id, GMAIL, { GOOGLE_REFRESH_TOKEN: X_TOKEN });
    await mcpUser.enableInWorkspace(x.id, b.id, GMAIL);
    return { x, y, a, b, c };
  };

  /** The tool names a run by `userId` of the workspace's agent is offered. */
  const offeredTools = async (userId: string, workspace: { id: string; agentId: string }) =>
    (await service.buildToolSchemasWithMcp([], workspace.agentId, userId, workspace.id, { mcpSession: createMcpRunSession() })).map(
      (schema) => schema.function.name,
    );

  it("AC 1: connected once (one credential, two switches), x's run in A and in B gets the Gmail tools with x's env", async () => {
    const { x, a, b } = await seed();

    expect(await prisma.userMcpCredential.count()).toBe(1);
    expect(await prisma.workspaceMcpConnection.count()).toBe(2);
    expect(await offeredTools(x.id, a)).toContain(GMAIL_TOOL);
    expect(await offeredTools(x.id, b)).toContain(GMAIL_TOOL);
    expect(connectedEnvs).toEqual([{ GOOGLE_REFRESH_TOKEN: X_TOKEN }, { GOOGLE_REFRESH_TOKEN: X_TOKEN }]);
  });

  it("AC 2: x's run in C (not switched on) is offered no Gmail tool and resolveCredentials returns null (negative)", async () => {
    const { x, c } = await seed();

    expect(await offeredTools(x.id, c)).not.toContain(GMAIL_TOOL);
    expect(mcpClient.connect).not.toHaveBeenCalled();
    await expect(mcpUser.resolveCredentials(x.id, c.id, GMAIL)).resolves.toBeNull();
  });

  it("AC 3: y, another member of A, runs the agent there: x's credential is never used (negative)", async () => {
    const { y, a } = await seed();

    expect(await offeredTools(y.id, a)).not.toContain(GMAIL_TOOL);
    expect(mcpClient.connect).not.toHaveBeenCalled();
    await expect(mcpUser.resolveCredentials(y.id, a.id, GMAIL)).resolves.toBeNull();
  });
});
