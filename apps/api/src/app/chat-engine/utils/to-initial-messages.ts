import type { ChatExecutionInput } from "../types/chat-execution-input";
import type { ChatLoopMessage } from "../types/chat-loop-message";

/** RNX-283: the loop's first messages: the agent's prompt with the permitted knowledge and memory, the conversation's (approved) history, then the approved input. */
export function toInitialMessages(input: ChatExecutionInput): ChatLoopMessage[] {
  const { agent, context, conversation, approvedInput } = input;
  const sections = [agent.systemPrompt, context.knowledge && `## Relevant Knowledge\n${context.knowledge}`, context.memory && `## About This User\n${context.memory}`];
  return [
    { role: "system", content: sections.filter(Boolean).join("\n\n") },
    ...conversation.history.map((message) => ({ role: message.role, content: message.content })),
    { role: "user", content: approvedInput },
  ];
}
