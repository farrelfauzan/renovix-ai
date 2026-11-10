import type { McpRunSession } from "../../agent/types/mcp-run-session";
import type { ToolSchema } from "../../agent/types/tool-schema";
import type { ChatEngineLoopProfile } from "./chat-engine-loop-profile";
import type { ChatExecutionInput } from "./chat-execution-input";
import type { ChatLoopMessage } from "./chat-loop-message";

/** RNX-283: one tool loop's own state (nothing is shared between runs): its input, profile, MCP session, offered tools, messages and rounds used. */
export type ChatToolLoopRun = {
  readonly input: ChatExecutionInput;
  readonly profile: ChatEngineLoopProfile;
  readonly mcpSession: McpRunSession;
  readonly tools: readonly ToolSchema[];
  readonly messages: ChatLoopMessage[];
  iterations: number;
};
