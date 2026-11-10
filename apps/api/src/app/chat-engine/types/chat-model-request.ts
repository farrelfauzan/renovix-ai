import type { ChatRequest } from "../../providers/provider.interface";

/** RNX-282: one model call an execution asks for: the request without its model and connection, which are the run agent's own (fixed by the engine's meter). */
export type ChatModelRequest = Omit<ChatRequest, "model" | "connection">;
