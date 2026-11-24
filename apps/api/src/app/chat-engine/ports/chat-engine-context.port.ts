import type { ChatContextRequest } from "../types/chat-context-request";
import type { ChatEngineContext } from "../types/chat-engine-context";

/**
 * RNX-24a: the run's context build, injected: what the model may see besides the input. ChatEngineContextService is
 * the agent run's (memory and knowledge); the channel chat brings its own (its room's workspace memory only, as before).
 */
export abstract class ChatEngineContextBuilder {
  /** The context for this runner and scope. */
  abstract buildContext(request: ChatContextRequest): Promise<ChatEngineContext>;
}
