import type { ChatEngineAgent } from "./chat-engine-agent";
import type { ChatEngineContext } from "./chat-engine-context";
import type { ChatEngineRequest } from "./chat-engine-request";
import type { ChatModelCall } from "./chat-model-call";
import type { McpRunSession } from "../../agent/types/mcp-run-session";

/**
 * What an execution gets: the runner, the conversation, the approved input only (never the raw one), the built context
 * and (RNX-282) `callModel`, its only way to the model, metered on the run's reservation. RNX-283: the source (its loop
 * profile), the authorized agent (prompt, model settings, tool rows) and the caller's abort signal. RNX-25 (D341 D1): the
 * request's options (which tools to offer) and the caller's MCP session, when it passes one.
 */
export type ChatExecutionInput = {
  readonly principal: ChatEngineRequest["principal"];
  readonly source: ChatEngineRequest["source"];
  readonly conversation: ChatEngineRequest["conversation"];
  readonly agent: ChatEngineAgent;
  readonly approvedInput: string;
  readonly context: ChatEngineContext;
  readonly callModel: ChatModelCall;
  readonly signal?: AbortSignal;
  readonly options?: ChatEngineRequest["options"];
  readonly mcpSession?: McpRunSession;
};
