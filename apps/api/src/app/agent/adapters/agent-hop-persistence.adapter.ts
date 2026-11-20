import { ChatEnginePersistence } from "../../chat-engine/ports/chat-engine-persistence.port";

/**
 * RNX-121b-1: the persistence port of a called agent's run: nothing is stored on any session (the parent run's stored
 * messages do not change; the hop's child row is written by AgentPeerRunService) and the answer is never handed to
 * memory (D324: a called agent's memory is read as context, never extracted).
 */
export class AgentHopPersistence extends ChatEnginePersistence {
  /** Stores nothing. */
  saveExchange(): Promise<void> {
    return Promise.resolve();
  }

  /** Extracts nothing. */
  handToMemory(): Promise<void> {
    return Promise.resolve();
  }
}
