import { ChatEngineContextBuilder } from "../../chat-engine/ports/chat-engine-context.port";
import type { ChatContextRequest } from "../../chat-engine/types/chat-context-request";
import type { ChatEngineContext } from "../../chat-engine/types/chat-engine-context";
import type { AgentMemoryService } from "../../agent/service/agent-memory.service";
import type { ChannelChatTurn } from "../types/channel-chat-turn";

/**
 * RNX-24a: the channel chat's context port, one per message, as the legacy CH loop read it: the workspace memory of the
 * message's room (AgentMemoryService.getWorkspaceMemoryContext with the channel id, none for a run outside the agent's
 * workspace, R17, on the channel adapter's scope), and no knowledge search and no user memory (CH never had them).
 */
export class ChannelChatContext extends ChatEngineContextBuilder {
  constructor(
    private readonly memory: AgentMemoryService,
    private readonly turn: ChannelChatTurn,
  ) {
    super();
  }

  /** The room's workspace memory and the offered tools; the scope is the engine's run policy answer. */
  async buildContext(request: ChatContextRequest): Promise<ChatEngineContext> {
    const { agentId, scope, channelId } = this.turn;
    const memory = await this.memory.getWorkspaceMemoryContext(agentId, scope, channelId);
    return { scope: request.scope, memory, knowledge: "", offeredTools: request.offeredTools };
  }
}
