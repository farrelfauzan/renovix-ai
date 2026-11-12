import type { LinkedAgent } from "../../agent/types/linked-agent";
import type { McpRunSession } from "../../agent/types/mcp-run-session";

/**
 * RNX-282: how a caller controls a run besides its request (not request data, so not in the Zod schema): `signal` aborts
 * it, in-flight work included. RNX-25 (D341 D1), each optional (without them the run is as before): `mcpSession` is the
 * caller's own MCP session for the run's tools (the caller reads the run's `create_document` output from it),
 * `linkedAgents` are the agents the run's agent may call (they count in the reservation's minimum, as in
 * AgentRunMeterService.meterRun), and `onReserved` runs once, right after the run's reservation holds and before its
 * first model call.
 */
export type ChatEngineRunOptions = {
  readonly signal?: AbortSignal;
  readonly mcpSession?: McpRunSession;
  readonly linkedAgents?: readonly LinkedAgent[];
  readonly onReserved?: () => Promise<void>;
};
