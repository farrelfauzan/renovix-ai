import { AgentToolService } from "./agent-tool.service";
import { AttachToolSchema } from "../dto/agent-chat.dto";
import { getAvailableTools } from "../utils/get-available-tools";
import { createMcpRunSession } from "../utils/create-mcp-run-session";

// With emitDecoratorMetadata (main's tsconfig.spec.json) constructor types are
// really imported, and those modules load the generated Prisma client and ESM
// packages that Jest cannot load. Every dependency is a stub in these tests.
jest.mock("../../prisma/prisma.service", () => ({ PrismaService: class {} }));
jest.mock("../../mcp/service/mcp-client.service", () => ({ McpClientService: class {} }));
jest.mock("../../mcp/service/mcp.service", () => ({ McpService: class {} }));
jest.mock("../../mcp/service/mcp-user.service", () => ({ McpUserService: class {} }));
jest.mock("../../mcp/service/web-search.service", () => ({ WebSearchService: class {} }));
jest.mock("./agent-memory.service", () => ({ AgentMemoryService: class {} }));
jest.mock("../../document/service/document.service", () => ({ DocumentService: class {} }));
jest.mock("../../providers/provider-router", () => ({ ProviderRouter: class {} }));

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

describe("RX-1: code_exec tool is removed", () => {
  it("is absent from the schema list built for an agent that still has a code_exec row", () => {
    const service = buildService();
    const schemas = service.buildToolSchemas([
      { toolType: "code_exec", enabled: true },
      { toolType: "calculator", enabled: true },
    ]);
    const names = schemas.map((s) => s.function.name);
    expect(names).not.toContain("code_exec");
    expect(names).toContain("calculator");
  });

  it("returns 'not available' and evaluates nothing when the model calls code_exec", async () => {
    const service = buildService();
    const marker = "__rx1_marker__";
    (globalThis as any)[marker] = false;
    const result = await service.executeTool(
      "code_exec",
      { language: "javascript", code: `globalThis.${marker} = true; return 1;` },
      { id: "agent-1" },
      createMcpRunSession(),
      "inside",
    );
    expect(result).toContain('Tool "code_exec" is not available');
    expect((globalThis as any)[marker]).toBe(false);
    delete (globalThis as any)[marker];
  });

  it("rejects attaching code_exec to an agent (denied path)", () => {
    const parsed = AttachToolSchema.safeParse({ toolType: "code_exec" });
    expect(parsed.success).toBe(false);
    expect(AttachToolSchema.safeParse({ toolType: "calculator" }).success).toBe(true);
  });

  it("is not offered in the tool catalog", async () => {
    const types = (await getAvailableTools()).map((t: any) => t.type);
    expect(types).not.toContain("code_exec");
  });
});

describe("RNX-118: call_agent replaces delegate_to_subagent", () => {
  it("offers neither tool from an agent's tool rows (an old delegate_to_subagent row, a call_agent row)", () => {
    const service = buildService();

    const names = service
      .buildToolSchemas([
        { toolType: "delegate_to_subagent", enabled: true },
        { toolType: "call_agent", enabled: true },
        { toolType: "calculator", enabled: true },
      ])
      .map((s) => s.function.name);

    expect(names).not.toContain("delegate_to_subagent");
    expect(names).not.toContain("call_agent");
    expect(names).toContain("calculator");
  });

  it("offers call_agent once, with agent, task and an optional context, only when the run asks for it", () => {
    const service = buildService();

    const schemas = service.buildToolSchemas([{ toolType: "calculator", enabled: true }], { injectCallAgent: true });
    const callAgent = schemas.filter((s) => s.function.name === "call_agent");

    expect(callAgent).toHaveLength(1);
    expect(Object.keys(callAgent[0].function.parameters.properties)).toEqual(["agent", "task", "context"]);
    expect(callAgent[0].function.parameters.required).toEqual(["agent", "task"]);
  });

  it("rejects attaching delegate_to_subagent or call_agent to an agent, and lists neither in the catalog", async () => {
    expect(AttachToolSchema.safeParse({ toolType: "delegate_to_subagent" }).success).toBe(false);
    expect(AttachToolSchema.safeParse({ toolType: "call_agent" }).success).toBe(false);
    const types = (await getAvailableTools()).map((t: any) => t.type);
    expect(types).not.toContain("delegate_to_subagent");
    expect(types).not.toContain("call_agent");
  });

  it("a call_agent the model makes outside a run's loop is not a tool here (the run handles it)", async () => {
    const service = buildService();

    const result = await service.executeTool("call_agent", { agent: "x", task: "y" }, { id: "agent-1" }, createMcpRunSession(), "inside");

    expect(result).toContain('Tool "call_agent" is not available');
  });
});
