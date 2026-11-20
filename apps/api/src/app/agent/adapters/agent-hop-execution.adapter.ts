import { ChatEngineExecution } from "../../chat-engine/ports/chat-engine-execution.port";
import type { ChatExecutionChunk } from "../../chat-engine/types/chat-execution-chunk";
import type { ChatExecutionInput } from "../../chat-engine/types/chat-execution-input";
import type { CallableAgent } from "../types/callable-agent";
import { callableAgentsSection } from "../utils/callable-agents-section";

/**
 * RNX-121b-1: the execution of a called agent's run: the engine's tool loop with the agent's own prompt (with its
 * permitted knowledge and memory, as the loop builds it), followed by the agents it may call itself, when it has any.
 */
export class AgentHopExecution extends ChatEngineExecution {
  constructor(
    private readonly loop: ChatEngineExecution,
    private readonly callableAgents: readonly CallableAgent[],
  ) {
    super();
  }

  /** Runs the tool loop with the called agent's prompt and its callable agents, and yields its chunks. */
  execute(input: ChatExecutionInput): AsyncIterable<ChatExecutionChunk> {
    const systemPrompt = `${input.agent.systemPrompt}${callableAgentsSection(this.callableAgents)}`;
    return this.loop.execute({ ...input, agent: { ...input.agent, systemPrompt } });
  }
}
