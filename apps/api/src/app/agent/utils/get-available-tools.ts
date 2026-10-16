export async function getAvailableTools() {
  return [
    {
      type: "knowledge_retrieval",
      name: "Knowledge Retrieval",
      description: "RAG search on attached knowledge bases",
      configRequired: false,
    },
    {
      type: "web_search",
      name: "Web Search",
      description: "Search the internet for real-time information",
      configRequired: true,
    },
    {
      type: "calculator",
      name: "Calculator",
      description: "Evaluate mathematical expressions",
      configRequired: false,
    },
    {
      type: "api_call",
      name: "API Call",
      description: "Call external HTTP APIs",
      configRequired: true,
    },
    {
      type: "memory_store",
      name: "Memory Store",
      description: "Store facts about the conversation user",
      configRequired: false,
    },
    {
      type: "delegate_to_subagent",
      name: "Delegate to Sub-Agent",
      description: "Delegate a task to a sub-agent",
      configRequired: true,
    },
    {
      type: "create_reminder",
      name: "Create Reminder",
      description: "Schedule automated messages on a recurring basis",
      configRequired: false,
    },
  ];
}
