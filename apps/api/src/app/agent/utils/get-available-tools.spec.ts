import { getAvailableTools } from "./get-available-tools";

const EXPECTED_TOOLS = [
  { type: "knowledge_retrieval", name: "Knowledge Retrieval", description: "RAG search on attached knowledge bases", configRequired: false },
  { type: "web_search", name: "Web Search", description: "Search the internet for real-time information", configRequired: true },
  { type: "calculator", name: "Calculator", description: "Evaluate mathematical expressions", configRequired: false },
  { type: "api_call", name: "API Call", description: "Call external HTTP APIs", configRequired: true },
  { type: "memory_store", name: "Memory Store", description: "Store facts about the conversation user", configRequired: false },
  { type: "create_reminder", name: "Create Reminder", description: "Schedule automated messages on a recurring basis", configRequired: false },
];

describe("RX-131: getAvailableTools (the tool catalog offered to agents)", () => {
  it("lists the six tools in this order (RNX-118: delegate_to_subagent removed)", async () => {
    const actual = await getAvailableTools();

    expect(actual).toEqual(EXPECTED_TOOLS);
  });

  it("returns a new list on every call", async () => {
    const actualFirst = await getAvailableTools();
    const actualSecond = await getAvailableTools();

    expect(actualFirst).not.toBe(actualSecond);
  });
});
