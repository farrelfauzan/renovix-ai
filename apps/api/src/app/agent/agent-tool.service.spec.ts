import { AgentToolService } from "./agent-tool.service";
import { AttachToolSchema } from "./dto/agent-chat.dto";
import { AgentService } from "./agent.service";

// With emitDecoratorMetadata (main's tsconfig.spec.json) constructor types are
// really imported, and those modules load the generated Prisma client and ESM
// packages that Jest cannot load. Every dependency is a stub in these tests.
jest.mock("../prisma/prisma.service", () => ({ PrismaService: class {} }));
jest.mock("../mcp/mcp-client.service", () => ({ McpClientService: class {} }));
jest.mock("../mcp/mcp.service", () => ({ McpService: class {} }));
jest.mock("../mcp/mcp-user.service", () => ({ McpUserService: class {} }));
jest.mock("../mcp/web-search.service", () => ({ WebSearchService: class {} }));
jest.mock("./agent-memory.service", () => ({ AgentMemoryService: class {} }));
jest.mock("../document/document.service", () => ({ DocumentService: class {} }));
jest.mock("../providers/provider-router", () => ({ ProviderRouter: class {} }));

function buildService() {
  const unused = {} as any;
  return new AgentToolService(
    unused, // mcpClient
    unused, // mcpService
    unused, // mcpUserService
    unused, // webSearchService
    unused, // memoryService
    unused, // documentService
    unused, // prisma
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
    const service = new AgentService({} as any, {} as any, {} as any);
    const types = (await service.getAvailableTools()).map((t: any) => t.type);
    expect(types).not.toContain("code_exec");
  });
});
