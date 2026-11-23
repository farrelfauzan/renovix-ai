import { replyLanguageSection } from "../../agent/utils/reply-language-section";
import type { CallableAgent } from "../../agent/types/callable-agent";
import type { ChannelChatPromptInput } from "../types/channel-chat-prompt-input";

/** The prompt of an agent without one. */
const DEFAULT_SYSTEM_PROMPT = "You are a helpful assistant.";
/** The document formats' names in the document generation mode. */
const DOCUMENT_FORMAT_LABELS: Readonly<Record<string, string>> = { pdf: "PDF", docx: "Word document", xlsx: "Excel spreadsheet" };
/** The memory policy section, always present. */
const MEMORY_POLICY_SECTION = `\n\n## Memory Policy\nAfter completing an important task (creating documents, spreadsheets, setting up resources, etc.), use the memory_store tool to save key details (IDs, URLs, names, structure) so you can reference them in future conversations.`;

/** The workspace memory section, or none without memory. */
function workspaceMemorySection(memory: string): string {
  return memory ? `\n\n## Workspace Memory\nHere are important facts you should remember:\n${memory}` : "";
}

/** The callable agents section (the CH wording), or none without callable agents. */
function callableAgentsSection(callableAgents: readonly CallableAgent[]): string {
  if (callableAgents.length === 0) return "";
  const callableList = callableAgents
    .map((callee) => `- ${callee.name} (id: ${callee.id})${callee.description ? `: ${callee.description}` : ""}`)
    .join("\n");
  return `\n\n## Callable Agents\n${callableList}\n\nCall policy:\n- Use the call_agent tool to give one of these agents a task.\n- Never invent agent names or IDs not in this list.`;
}

/** The document generation mode section, or none without a document format. */
function documentModeSection(documentFormat?: string): string {
  if (!documentFormat) return "";
  const formatLabel = DOCUMENT_FORMAT_LABELS[documentFormat] || documentFormat;
  return `\n\n## Document Generation Mode\nThe user wants a ${formatLabel} document. Follow these steps:\n1. If you have tools available (web_search, call_agent), USE THEM FIRST to research the topic thoroughly before writing.\n2. Write comprehensive, well-structured markdown content with proper headings, sections, and details.\n3. The markdown you produce will be automatically converted to ${formatLabel}. Focus on quality content.`;
}

/**
 * RNX-24a: the channel chat's (CH) system prompt, as ChannelChatService built it before the chat engine: the agent's
 * prompt (or the default), the room's workspace memory, the memory policy, the callable agents, the document generation
 * mode, and (RNX-335) last the runner's reply language; each optional section only when it has content.
 */
export function buildChannelChatSystemPrompt(input: ChannelChatPromptInput): string {
  const base = input.systemPrompt || DEFAULT_SYSTEM_PROMPT;
  return `${base}${workspaceMemorySection(input.memory)}${MEMORY_POLICY_SECTION}${callableAgentsSection(input.callableAgents)}${documentModeSection(input.documentFormat)}${replyLanguageSection(input.runnerLocale)}`;
}
