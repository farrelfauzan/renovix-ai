import { mcpToolToOpenAI } from "./mcp-tool-to-openai";

const SCHEMA = { type: "object", properties: { q: { type: "string" } }, required: ["q"] };

describe("RX-131: mcpToolToOpenAI (an MCP tool schema in OpenAI function-calling format)", () => {
  it.each([
    {
      name: "name, description and input schema",
      tool: { name: "search", description: "Find pages", inputSchema: SCHEMA },
      expected: { type: "function", function: { name: "search", description: "Find pages", parameters: SCHEMA } },
    },
    {
      name: "no description",
      tool: { name: "search", inputSchema: SCHEMA },
      expected: { type: "function", function: { name: "search", description: "", parameters: SCHEMA } },
    },
    {
      name: "no input schema",
      tool: { name: "ping", description: "Ping", inputSchema: undefined as unknown as Record<string, any> },
      expected: { type: "function", function: { name: "ping", description: "Ping", parameters: { type: "object", properties: {} } } },
    },
  ])("$name", ({ tool, expected }) => {
    const actual = mcpToolToOpenAI(tool);

    expect(actual).toEqual(expected);
  });

  it("passes the input schema on as the same object", () => {
    const actual = mcpToolToOpenAI({ name: "search", inputSchema: SCHEMA });

    expect(actual.function.parameters).toBe(SCHEMA);
  });
});
