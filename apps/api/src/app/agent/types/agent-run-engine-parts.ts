import type { AgentRunPersistence } from "../adapters/agent-run-persistence.adapter";
import type { ChatEngineAgent } from "../../chat-engine/types/chat-engine-agent";
import type { AgentRunTurn } from "./agent-run-turn";
import type { CallableAgent } from "./callable-agent";

/**
 * RNX-25: what one agent message's chat engine is built from: its turn, the authorized agent, its callable agents, its
 * persistence and the document format asked for. RNX-121b-1: the run's abort signal (its agent calls stop with it).
 * RNX-326: the route's socket timeout, when it sets one (the run time limit is cut at it).
 */
export type AgentRunEngineParts = {
  readonly turn: AgentRunTurn;
  readonly agent: ChatEngineAgent;
  readonly callableAgents: readonly CallableAgent[];
  readonly persistence: AgentRunPersistence;
  readonly documentFormat?: string;
  readonly signal?: AbortSignal;
  readonly socketTimeoutMs?: number;
};
