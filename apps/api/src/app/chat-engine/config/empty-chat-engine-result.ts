import type { ChatEngineResult } from "../types/chat-engine-result";

/** The result a collected run starts from, before any event is folded in. */
export const EMPTY_CHAT_ENGINE_RESULT: ChatEngineResult = { status: "completed", reason: null, content: null, context: null, toolResults: [] };
