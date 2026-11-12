import { EventEmitter } from "node:events";
import type { ServerResponse } from "node:http";
import { SseStream } from "../../../common/utils/sse-stream";
import type { ChatEngineEvent } from "../types/chat-engine-event";
import { writeChatEngineEvents } from "./write-chat-engine-events";
import { sseEvents } from "../../../../test/sse-client";

// RNX-42 AC8: a fake RNX-281 event stream (streaming mode: ChatEngineService.run's events, one at a time) written
// through the adapter on the SSE helper. The source's mapping is the test's own: the context event is a status
// payload, the content event a content chunk and the denied event an error payload (the engine has no separate
// status or error event type); done maps to nothing, since the adapter writes [DONE] itself.

/** A stand-in ServerResponse that records what is written and how often it is ended. */
const createFakeResponse = () => {
  const response = Object.assign(new EventEmitter(), {
    writeHead: jest.fn(),
    write: jest.fn(),
    end: jest.fn(),
    destroyed: false,
    writableEnded: false,
    req: { headers: {} },
  });
  response.end.mockImplementation(() => void (response.writableEnded = true));
  return response;
};

/** Yields the events one by one, each after a turn of the event loop, as a streamed run does. */
async function* streamOf(events: readonly ChatEngineEvent[]): AsyncGenerator<ChatEngineEvent> {
  for (const event of events) {
    await new Promise((resolve) => setImmediate(resolve));
    yield event;
  }
}

/** The test source's payloads for each engine event. */
const toTestPayloads = (event: ChatEngineEvent): readonly unknown[] => {
  if (event.type === "context") return [{ status: "understanding" }];
  if (event.type === "content") return [{ choices: [{ delta: { content: event.content } }] }];
  if (event.type === "denied") return [{ error: { message: event.reason } }];
  return [];
};

describe("RNX-42 AC8: writeChatEngineEvents, the RNX-281 event stream on the SSE helper", () => {
  it("content, status and error events reach the client in order, and the stream ends once with [DONE]", async () => {
    const response = createFakeResponse();
    const sse = new SseStream(response as unknown as ServerResponse);
    sse.open();
    const inputEvents: ChatEngineEvent[] = [
      { type: "context", context: { scope: "inside", memory: "", knowledge: "", offeredTools: [] } },
      { type: "content", status: "approved", content: "Hello there" },
      { type: "denied", reason: "not_runnable" },
      { type: "done" },
    ];

    await writeChatEngineEvents({ sse, events: streamOf(inputEvents), toPayloads: toTestPayloads });
    sse.end();
    sse.writeData("[DONE]");

    const actualBody = response.write.mock.calls.map(([text]) => text as string).join("");
    expect(sseEvents(actualBody)).toEqual([
      { status: "understanding" },
      { choices: [{ delta: { content: "Hello there" } }] },
      { error: { message: "not_runnable" } },
      "[DONE]",
    ]);
    expect(response.end).toHaveBeenCalledTimes(1);
  });
});
