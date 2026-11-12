import type { ChatEngineSseWrite } from "../types/chat-engine-sse-write";

/**
 * RNX-42: writes a streamed RNX-281 run through the SSE helper: each event's payloads (the source's own, as JSON
 * `data:` events) in the order the run yields them, then `data: [DONE]`, and ends the response once. An error the run
 * throws is not caught here: it reaches guardSseStream, which ends the stream with its error event.
 */
export async function writeChatEngineEvents({ sse, events, toPayloads }: ChatEngineSseWrite): Promise<void> {
  for await (const event of events) {
    toPayloads(event).forEach((payload) => sse.writeJson(payload));
  }
  sse.writeData("[DONE]");
  sse.end();
}
