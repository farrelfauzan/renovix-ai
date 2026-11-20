import { Logger } from "@nestjs/common";
import { CHAT_ENGINE_AGENT_NOT_CALLABLE } from "../../chat-engine/config/chat-engine.config";
import { ChatEnginePeerCall } from "../../chat-engine/ports/chat-engine-peer-call.port";
import type { ChatPeerCallRequest } from "../../chat-engine/types/chat-peer-call-request";
import { PEER_CALL_MESSAGES } from "../config/peer-call-messages";
import { CallAgentArgsSchema } from "../dto/call-agent-args.dto";
import type { AgentPeerRunService } from "../service/agent-peer-run.service";
import type { CallableAgent } from "../types/callable-agent";
import type { PeerCallFrame } from "../types/peer-call-frame";
import { toCalleeInput } from "../utils/to-callee-input";

/**
 * RNX-121b-1: the chat engine's agent-call port for one agent of an agent run (the run's own agent, or a called agent
 * that may call its own links). The call_agent arguments are checked with Zod, and only an agent of the frame's
 * callable agents (RNX-118: a live, active linked agent of the workspace, none for a run outside it) is called: any
 * other name is refused and nothing runs or is written (D351 6). The call itself is AgentPeerRunService's.
 */
export class AgentPeerCall extends ChatEnginePeerCall {
  private readonly logger = new Logger(AgentPeerCall.name);

  constructor(
    private readonly runtime: AgentPeerRunService,
    private readonly frame: PeerCallFrame,
  ) {
    super();
  }

  /** The called agent's answer, or the "Error: …" text of a refused or failed call; a budget stop ends the run. */
  async callPeer(request: ChatPeerCallRequest): Promise<string> {
    const args = CallAgentArgsSchema.safeParse(request.args);
    if (!args.success) return PEER_CALL_MESSAGES.invalidArguments;
    const callee = this.findCallee(args.data.agent);
    if (!callee) {
      this.logger.warn(`call_agent refused: agent ${this.frame.agent.id} may not call "${args.data.agent}"`);
      return CHAT_ENGINE_AGENT_NOT_CALLABLE;
    }
    return this.runtime.callAgent({ frame: this.frame, request, callee, task: toCalleeInput(this.frame.agent.name, args.data) });
  }

  /** The callable agent with this id, or this name in any casing (RNX-124 D165). */
  private findCallee(identifier: string): CallableAgent | undefined {
    const name = identifier.toLowerCase();
    return this.frame.callableAgents.find((callee) => callee.id === identifier || callee.name.toLowerCase() === name);
  }
}
