import { TestingModule } from "@nestjs/testing";
import { AgentToolService } from "./agent-tool.service";
import { McpClientService } from "../../mcp/service/mcp-client.service";
import { McpService } from "../../mcp/service/mcp.service";
import { McpUserService } from "../../mcp/service/mcp-user.service";
import { WebSearchService } from "../../mcp/service/web-search.service";
import { AgentMemoryService } from "./agent-memory.service";
import { DocumentService } from "../../document/service/document.service";
import { PrismaService } from "../../prisma/prisma.service";
import { createTestModule } from "../../../../test/test-module";
import { resetDatabase } from "../../../../test/test-database";
import { createAgent, createUser, createWorkspace } from "../../../../test/factories";

// RNX-117 (answer 1, test database): an agent in its owner's default workspace gets no MCP discovery and no web
// search, exactly like an agent without a workspace before every agent had one (agent-run and the reminder
// scheduler pass `agent.workspaceId`; the web_search tool reads `agent.workspaceId`). An agent in another
// workspace is the control. The MCP and web search services are stubs (their modules load ESM packages).
jest.mock("../../mcp/service/mcp-client.service", () => ({ McpClientService: class {} }));
jest.mock("../../mcp/service/mcp.service", () => ({ McpService: class {} }));
jest.mock("../../mcp/service/mcp-user.service", () => ({ McpUserService: class {} }));
jest.mock("../../mcp/service/web-search.service", () => ({ WebSearchService: class {} }));
jest.mock("./agent-memory.service", () => ({ AgentMemoryService: class {} }));
jest.mock("../../document/service/document.service", () => ({ DocumentService: class {} }));
jest.mock("../../providers/provider-router", () => ({ ProviderRouter: class {} }));

type WebSearch = (args: { query: string }, userId?: string, workspaceId?: string) => Promise<string>;

const UNAVAILABLE = "Web search is unavailable because user or workspace context is missing.";

describe("RNX-117: no MCP discovery and no web search for an agent in a default workspace (test database)", () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let service: AgentToolService;
  const mcpUser = { getUserConnectedProviders: jest.fn(async () => new Map()) };
  const webSearch = { search: jest.fn(async () => "search results") };

  beforeAll(async () => {
    ({ moduleRef, prisma } = await createTestModule({
      providers: [
        AgentToolService,
        { provide: McpUserService, useValue: mcpUser },
        { provide: WebSearchService, useValue: webSearch },
        ...[McpClientService, McpService, AgentMemoryService, DocumentService].map((provide) => ({ provide, useValue: {} })),
      ],
    }));
    service = moduleRef.get(AgentToolService);
  });

  beforeEach(async () => {
    await resetDatabase(prisma);
    jest.clearAllMocks();
  });

  afterAll(() => moduleRef?.close());

  // The web_search case of executeTool is `this.executeWebSearch(args, userId, agent?.workspaceId)`; called
  // directly because executeTool races it against a 30 s timer that would keep Jest open.
  const searchAs = (agent: { workspaceId: string }, userId: string) =>
    (service as unknown as { executeWebSearch: WebSearch }).executeWebSearch({ query: "news" }, userId, agent.workspaceId);

  const tools = [{ toolType: "web_search", enabled: true }, { toolType: "calculator", enabled: true }];

  const setup = async () => {
    const user = await createUser(prisma);
    const inDefault = await createAgent(prisma, { userId: user.id });
    const team = await createWorkspace(prisma, { ownerId: user.id });
    const inTeam = await createAgent(prisma, { userId: user.id, workspaceId: team.id });
    expect(await prisma.workspace.findUniqueOrThrow({ where: { id: inDefault.workspaceId } })).toMatchObject({ isDefault: true });
    return { user, inDefault, team, inTeam };
  };

  it("discovers no MCP tools for an agent in its default workspace: only the built-in tools", async () => {
    const { user, inDefault } = await setup();

    const schemas = await service.buildToolSchemasWithMcp(tools, inDefault.id, user.id, inDefault.workspaceId);

    expect(schemas).toEqual(service.buildToolSchemas(tools));
    expect(mcpUser.getUserConnectedProviders).not.toHaveBeenCalled();
  });

  it("control: discovers MCP tools in the agent's workspace when it is not a default one", async () => {
    const { user, team, inTeam } = await setup();

    await service.buildToolSchemasWithMcp(tools, inTeam.id, user.id, inTeam.workspaceId);

    expect(mcpUser.getUserConnectedProviders).toHaveBeenCalledWith(user.id, team.id);
  });

  it("web search answers 'unavailable' for an agent in its default workspace and searches nothing", async () => {
    const { user, inDefault } = await setup();

    expect(await searchAs(inDefault, user.id)).toBe(UNAVAILABLE);
    expect(webSearch.search).not.toHaveBeenCalled();
  });

  it("control: web search runs in the agent's workspace when it is not a default one", async () => {
    const { user, team, inTeam } = await setup();

    expect(await searchAs(inTeam, user.id)).toBe("search results");
    expect(webSearch.search).toHaveBeenCalledWith(user.id, team.id, "news", undefined);
  });
});
