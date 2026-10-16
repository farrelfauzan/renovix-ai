import { AgentToolService } from "./agent-tool.service";

// The file under test loads marked (ESM-only, Jest cannot load it); this function does not use it.
jest.mock("marked", () => ({}));

describe("RX-131: executeKnowledgeRetrieval (the knowledge_retrieval tool's answer; the search itself runs in the run service)", () => {
  it.each([
    { name: "a query", query: "pricing", agent: { id: "agent-1" }, expected: 'Knowledge retrieval for "pricing" completed. Results injected into context.' },
    { name: "an empty query", query: "", agent: { id: "agent-1" }, expected: 'Knowledge retrieval for "" completed. Results injected into context.' },
    { name: "quotes in the query are not escaped", query: 'say "hi"', agent: { id: "agent-1" }, expected: 'Knowledge retrieval for "say "hi"" completed. Results injected into context.' },
    { name: "the agent is not used", query: "pricing", agent: undefined, expected: 'Knowledge retrieval for "pricing" completed. Results injected into context.' },
  ])("$name: '$query'", async ({ query, agent, expected }) => {
    const actual = await AgentToolService.prototype["executeKnowledgeRetrieval"]({ query }, agent);

    expect(actual).toBe(expected);
  });
});
