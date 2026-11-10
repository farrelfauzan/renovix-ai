/** What an execution yields: a piece of the model's raw text, or a tool result (checked against the contract by the engine). */
export type ChatExecutionChunk =
  | { readonly type: "text"; readonly text: string }
  | { readonly type: "tool_result"; readonly toolName: string; readonly content: unknown };
