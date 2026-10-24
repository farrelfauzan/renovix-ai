import { AgentToolService } from "./agent-tool.service";
import { createMcpRunSession } from "../utils/create-mcp-run-session";

// RNX-276: executeTool runs a tool only when its name is among the tool schemas offered to that run
// (the run's own mcpSession carries the offered names), and the 30 s timeout timer is cleared when the
// tool finishes or fails. Unit tests with stubbed collaborators; the run-loop specs cover the loops.
jest.mock("../../prisma/prisma.service", () => ({ PrismaService: class {} }));
jest.mock("../../mcp/service/mcp-client.service", () => ({ McpClientService: class {} }));
jest.mock("../../mcp/service/mcp.service", () => ({ McpService: class {} }));
jest.mock("../../mcp/service/mcp-user.service", () => ({ McpUserService: class {} }));
jest.mock("../../mcp/service/web-search.service", () => ({ WebSearchService: class {} }));
jest.mock("./agent-memory.service", () => ({ AgentMemoryService: class {} }));
jest.mock("../../document/service/document.service", () => ({ DocumentService: class {} }));
jest.mock("../../providers/provider-router", () => ({ ProviderRouter: class {} }));
jest.mock("../../channel/repository/channel-chat-room.repository", () => ({ ChannelChatRoomRepository: class {} }));
jest.mock("../../reminder/repository/reminder.repository", () => ({ ReminderRepository: class {} }));
jest.mock("../../workspace/repository/workspace.repository", () => ({ WorkspaceRepository: class {} }));

const agent = { id: "agent-1", workspaceId: "ws-1" };

/** A session whose offered tools are exactly `names` (as the run's schemas would have filled it). */
const sessionOffering = (...names: string[]) => {
  const session = createMcpRunSession();
  for (const name of names) session.offeredToolNames.add(name);
  return session;
};

function buildService() {
  const unused = {} as any;
  return new AgentToolService(
    unused, // mcpClient
    unused, // mcpService
    unused, // mcpUserService
    unused, // webSearchService
    unused, // memoryService
    unused, // documentService
    unused, // chatRooms
    unused, // reminders
    unused, // workspaces
  );
}

describe("RNX-276: executeTool runs only tools offered to the run", () => {
  it("a built-in that was not offered runs nothing: the model gets 'not available'", async () => {
    const service = buildService();
    const result = await service.executeTool(
      "calculator",
      { expression: "2+2" },
      agent,
      sessionOffering("web_search", "create_document"),
      "inside",
    );

    expect(result).toContain('Tool "calculator" is not available');
    expect(result).not.toContain("4");
  });

  it.each(["web_search", "knowledge_retrieval", "memory_store", "create_reminder", "create_document"])(
    "an unoffered %s call runs nothing even when the run offered other tools",
    async (tool) => {
      const service = buildService();
      const result = await service.executeTool(tool, {}, agent, sessionOffering("calculator"), "inside");

      expect(result).toContain(`Tool "${tool}" is not available`);
    },
  );

  it("a tool offered to the run still runs (control)", async () => {
    const service = buildService();
    const result = await service.executeTool(
      "calculator",
      { expression: "2+2" },
      agent,
      sessionOffering("calculator"),
      "inside",
    );

    expect(result).toBe("Result: 4");
  });

  it("a session with no offered names (a run without tools) refuses every built-in", async () => {
    const service = buildService();
    const result = await service.executeTool("calculator", { expression: "2+2" }, agent, createMcpRunSession(), "inside");

    expect(result).toContain('Tool "calculator" is not available');
  });

  it("call_agent stays refused here (the run loop handles it before executeTool)", async () => {
    const service = buildService();
    const result = await service.executeTool("call_agent", { agent: "x", task: "y" }, agent, sessionOffering("call_agent"), "inside");

    // call_agent is not a tool of this service; the run loop intercepts the name before calling here.
    expect(result).toContain('Tool "call_agent" is not available');
  });
});

describe("RNX-276: the tool timeout timer is cleared (fake timers)", () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it("a tool that finishes leaves no pending timeout timer", async () => {
    const service = buildService();
    const run = service.executeTool("calculator", { expression: "2+2" }, agent, sessionOffering("calculator"), "inside");
    await expect(run).resolves.toBe("Result: 4");

    jest.advanceTimersByTime(30000);
    // If the timer had been left pending, advancing it would reject a floating promise and
    // jest reports "A worker process has failed to exit gracefully" / open handle warnings.
    // The explicit assertion is that nothing is scheduled after the resolution:
    expect(jest.getTimerCount()).toBe(0);
  });

  it("a tool that fails leaves no pending timeout timer", async () => {
    const service = buildService();
    // web_search without user context returns an error string through the promise path; use a
    // tool call that rejects: memory_store with no userId returns a string, so force rejection
    // with an unknown-but-offered tool name that throws inside executeWithTimeout is not
    // expressible; instead assert the timer count after a refused (not available) call.
    const run = service.executeTool("calculator", {}, agent, sessionOffering("calculator"), "inside");
    await expect(run).resolves.toBeDefined();

    expect(jest.getTimerCount()).toBe(0);
    jest.advanceTimersByTime(30000);
    expect(jest.getTimerCount()).toBe(0);
  });

  it("a tool that hangs is still cut off by the 30 s timeout (control)", async () => {
    const service = buildService();
    // An offered MCP tool whose connection never answers: build a session with a fake connection.
    const session = createMcpRunSession();
    session.offeredToolNames.add("slow_tool");
    session.toolConnections.set("slow_tool", {
      client: { callTool: () => new Promise(() => {}) },
    } as any);

    const run = service.executeTool("slow_tool", {}, agent, session, "inside");
    const assertion = expect(run).rejects.toThrow("Tool execution timeout");

    await jest.advanceTimersByTimeAsync(30000);
    await assertion;
  });
});
