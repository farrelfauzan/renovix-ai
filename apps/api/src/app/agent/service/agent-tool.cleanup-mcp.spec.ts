import { AgentToolService } from "./agent-tool.service";
import { createMcpRunSession } from "../utils/create-mcp-run-session";
import type { McpConnection } from "../../mcp/types/mcp-connection";
import { captureLogLines } from "../../../../test/capture-log-lines";

// RNX-217: cleanupMcpConnections closes the connections of the session it is given, all of them, concurrently, and
// waits for all; one that fails to close is logged by its server id only. Every dependency is a stub (their modules
// load the generated Prisma client and ESM packages, as in agent-tool.service.spec.ts).
jest.mock("../../prisma/prisma.service", () => ({ PrismaService: class {} }));
jest.mock("../../mcp/service/mcp-client.service", () => ({ McpClientService: class {} }));
jest.mock("../../mcp/service/mcp.service", () => ({ McpService: class {} }));
jest.mock("../../mcp/service/mcp-user.service", () => ({ McpUserService: class {} }));
jest.mock("../../mcp/service/web-search.service", () => ({ WebSearchService: class {} }));
jest.mock("./agent-memory.service", () => ({ AgentMemoryService: class {} }));
jest.mock("../../document/service/document.service", () => ({ DocumentService: class {} }));
jest.mock("../../providers/provider-router", () => ({ ProviderRouter: class {} }));

const SECRET_IN_ERROR = "rnx217-error-text-with-a-token";

describe("AgentToolService.cleanupMcpConnections (RNX-217)", () => {
  afterEach(() => jest.restoreAllMocks());

  const connection = (serverId: string): McpConnection => ({ serverId, client: {}, credentialDir: null }) as McpConnection;

  /** The service with an McpClientService stub whose close fails for `failing` and waits for `allStarted` otherwise. */
  const buildService = (failing: string) => {
    const started: string[] = [];
    let releaseAll!: () => void;
    const allStarted = new Promise<void>((resolve) => (releaseAll = resolve));
    const close = jest.fn(async (c: McpConnection) => {
      started.push(c.serverId);
      if (started.length === 3) releaseAll();
      await allStarted;
      if (c.serverId === failing) throw new Error(SECRET_IN_ERROR);
    });
    const unused = {} as never;
    const service = new AgentToolService({ close } as never, unused, unused, unused, unused, unused, unused, unused, unused, unused);
    return { service, close, started };
  };

  it("closes every connection of the session concurrently (all three started before any finished)", async () => {
    const { service, close } = buildService("none");
    const session = createMcpRunSession();
    session.connections.push(connection("github-u1"), connection("slack-u1"), connection("notion-u1"));

    await service.cleanupMcpConnections(session);

    expect(close.mock.calls.map(([c]) => c.serverId)).toEqual(["github-u1", "slack-u1", "notion-u1"]);
  });

  it("one close fails: the others are still closed, the warning names the server id only, nothing is thrown", async () => {
    const { service, close } = buildService("slack-u1");
    const session = createMcpRunSession();
    session.connections.push(connection("github-u1"), connection("slack-u1"), connection("notion-u1"));
    const { lines } = captureLogLines();

    await expect(service.cleanupMcpConnections(session)).resolves.toBeUndefined();

    expect(close).toHaveBeenCalledTimes(3);
    expect(lines).toEqual(["Failed to close MCP server slack-u1"]);
    expect(lines.join("\n")).not.toContain(SECRET_IN_ERROR);
  });

  it("empties the session: a second cleanup closes nothing, and no tool name maps to a closed connection", async () => {
    const { service, close } = buildService("none");
    const session = createMcpRunSession();
    const github = connection("github-u1");
    session.connections.push(github, connection("slack-u1"), connection("notion-u1"));
    session.toolConnections.set("create_issue", github);

    await service.cleanupMcpConnections(session);
    await service.cleanupMcpConnections(session);

    expect(close).toHaveBeenCalledTimes(3);
    expect([session.connections, [...session.toolConnections]]).toEqual([[], []]);
  });
});
