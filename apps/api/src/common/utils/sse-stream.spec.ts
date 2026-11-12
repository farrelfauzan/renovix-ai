import { EventEmitter } from "node:events";
import type { ServerResponse } from "node:http";
import { SseStream } from "./sse-stream";
import { SSE_HEARTBEAT_INTERVAL_MS } from "../config/sse-heartbeat-interval-ms";

// RNX-42: the SSE helper on a stand-in response (an EventEmitter that records writeHead, write and end), with Jest's
// fake timers, so the heartbeat is driven without waiting and no timer outlives a test.

const TEST_HEARTBEAT_MS = 50;
const ALLOWED_ORIGIN = "https://chat.rnx42.test";
const FOREIGN_ORIGIN = "https://evil.rnx42.test";

type FakeResponse = EventEmitter & {
  writeHead: jest.Mock;
  write: jest.Mock;
  end: jest.Mock;
  destroyed: boolean;
  writableEnded: boolean;
  req: { headers: { origin?: string } };
};

/** A stand-in ServerResponse of a request from `origin`. */
const createFakeResponse = (origin?: string): FakeResponse => {
  const response = Object.assign(new EventEmitter(), {
    writeHead: jest.fn(),
    write: jest.fn(),
    end: jest.fn(),
    destroyed: false,
    writableEnded: false,
    req: { headers: origin === undefined ? {} : { origin } },
  });
  response.end.mockImplementation(() => void (response.writableEnded = true));
  return response;
};

/** An opened helper on a fake response, with the 50 ms test heartbeat. */
const openStream = (origin?: string) => {
  const response = createFakeResponse(origin);
  const sse = new SseStream(response as unknown as ServerResponse, { heartbeatIntervalMs: TEST_HEARTBEAT_MS });
  sse.open();
  return { response, sse };
};

/** What was written, in order. */
const writtenOf = (response: FakeResponse): string[] => response.write.mock.calls.map(([text]) => text as string);

describe("RNX-42: SseStream, the one SSE response helper", () => {
  const savedCorsOrigin = process.env.CORS_ORIGIN;

  beforeEach(() => jest.useFakeTimers());

  afterEach(() => {
    jest.useRealTimers();
    if (savedCorsOrigin === undefined) delete process.env.CORS_ORIGIN;
    else process.env.CORS_ORIGIN = savedCorsOrigin;
  });

  it("the heartbeat interval is one constant of 15 s", () => {
    expect(SSE_HEARTBEAT_INTERVAL_MS).toBe(15_000);
  });

  it("AC1: open writes status 200 with text/event-stream, no-cache and keep-alive", () => {
    const { response, sse } = openStream();

    expect(response.writeHead).toHaveBeenCalledTimes(1);
    expect(response.writeHead.mock.calls[0][0]).toBe(200);
    expect(response.writeHead.mock.calls[0][1]).toMatchObject({
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    });
    sse.end();
  });

  it("writes data events, JSON events and comments as SSE text", () => {
    const { response, sse } = openStream();

    sse.writeJson({ status: "understanding" });
    sse.writeData("[DONE]");
    sse.writeComment("note");
    sse.end();

    expect(writtenOf(response)).toEqual(['data: {"status":"understanding"}\n\n', "data: [DONE]\n\n", ": note\n\n"]);
  });

  it("AC2: with a 50 ms heartbeat and no event for 3 intervals, the body has at least two `: heartbeat` comments", () => {
    const { response, sse } = openStream();

    jest.advanceTimersByTime(3 * TEST_HEARTBEAT_MS);

    expect(writtenOf(response).filter((text) => text === ": heartbeat\n\n").length).toBeGreaterThanOrEqual(2);
    sse.end();
  });

  it("AC2: after end, nothing more is written, the timer is cleared and the response is ended exactly once", () => {
    const { response, sse } = openStream();
    jest.advanceTimersByTime(TEST_HEARTBEAT_MS);
    const writesBeforeEnd = response.write.mock.calls.length;

    sse.end();
    sse.end();
    sse.writeJson({ late: true });
    jest.advanceTimersByTime(5 * TEST_HEARTBEAT_MS);

    expect(response.write.mock.calls.length).toBe(writesBeforeEnd);
    expect(jest.getTimerCount()).toBe(0);
    expect(response.end).toHaveBeenCalledTimes(1);
    expect(response.listenerCount("close")).toBe(0);
    expect(sse.signal.aborted).toBe(false); // a stream that ended is not a disconnect
  });

  it("AC2/AC4: the client leaves → the signal is aborted, the timer cleared, the listener removed, and nothing more is written", () => {
    const { response, sse } = openStream();
    jest.advanceTimersByTime(TEST_HEARTBEAT_MS);
    const writesBeforeClose = response.write.mock.calls.length;

    response.emit("close");
    sse.writeJson({ late: true });
    jest.advanceTimersByTime(5 * TEST_HEARTBEAT_MS);
    sse.end();

    expect(sse.signal.aborted).toBe(true);
    expect(jest.getTimerCount()).toBe(0);
    expect(response.listenerCount("close")).toBe(0);
    expect(response.write.mock.calls.length).toBe(writesBeforeClose);
    expect(response.end).not.toHaveBeenCalled(); // the socket is gone: nothing to end
  });

  it("the close that follows a normal end does not abort the signal", () => {
    const { response, sse } = openStream();

    sse.end();
    response.emit("close");

    expect(sse.signal.aborted).toBe(false);
  });

  describe("AC6: CORS from the app's allow-list (CORS_ORIGIN set, D324)", () => {
    beforeEach(() => {
      process.env.CORS_ORIGIN = ALLOWED_ORIGIN;
    });

    it("negative: an origin not in the list gets no Access-Control-Allow-Origin and no credentials header", () => {
      const { response, sse } = openStream(FOREIGN_ORIGIN);

      const headers = response.writeHead.mock.calls[0][1];
      expect(headers).not.toHaveProperty("Access-Control-Allow-Origin");
      expect(headers).not.toHaveProperty("Access-Control-Allow-Credentials");
      expect(headers.Vary).toBe("Origin");
      sse.end();
    });

    it("control: the listed origin gets itself (never `*`) with credentials, as the app's CORS sets it", () => {
      const { response, sse } = openStream(ALLOWED_ORIGIN);

      expect(response.writeHead.mock.calls[0][1]).toMatchObject({
        "Access-Control-Allow-Origin": ALLOWED_ORIGIN,
        "Access-Control-Allow-Credentials": "true",
        Vary: "Origin",
      });
      sse.end();
    });

    it("negative: a request without an Origin gets no Access-Control-Allow-Origin", () => {
      const { response, sse } = openStream();

      expect(response.writeHead.mock.calls[0][1]).not.toHaveProperty("Access-Control-Allow-Origin");
      sse.end();
    });
  });
});
