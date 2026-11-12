import type { SseStream } from "../../../common/utils/sse-stream";
import type { ChatEngineEvent } from "./chat-engine-event";

/**
 * RNX-42: what `writeChatEngineEvents` writes: a streamed run's events (ChatEngineService.run), the opened SSE helper,
 * and the source's own payloads for each event (none skips it), so every source keeps its SSE payloads.
 */
export type ChatEngineSseWrite = {
  readonly sse: SseStream;
  readonly events: AsyncIterable<ChatEngineEvent>;
  readonly toPayloads: (event: ChatEngineEvent) => readonly unknown[];
};
