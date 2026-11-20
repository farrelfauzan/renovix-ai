import type { CallableAgent } from "../types/callable-agent";

/** The callable agents section of an agent's system prompt (RNX-118), or none without callable agents. */
export function callableAgentsSection(callableAgents: readonly CallableAgent[]): string {
  if (callableAgents.length === 0) return "";
  const callableList = callableAgents
    .map((callee) => `- ${callee.name} (id: ${callee.id})${callee.description ? `: ${callee.description}` : ""}`)
    .join("\n");
  return `\n\n## Callable Agents\n${callableList}\n\nCall policy:\n- Use the call_agent tool to give one of these agents a task.\n- You may only call agents from this list; never invent agent names, IDs, or capabilities.`;
}
