import type { ServerResponse } from "node:http";
import { SSE_HEARTBEAT_INTERVAL_MS } from "../config/sse-heartbeat-interval-ms";
import type { SseStreamOptions } from "../types/sse-stream-options";
import { buildSseCorsHeaders } from "./build-sse-cors-headers";
import { resolveCorsOrigins } from "./resolve-cors-origins";

/** The headers every SSE response is opened with. */
const SSE_HEADERS: Readonly<Record<string, string>> = {
  "Content-Type": "text/event-stream",
  "Cache-Control": "no-cache",
  Connection: "keep-alive",
};

/**
 * RNX-42: the one SSE response helper. `open` writes status 200 with the SSE headers and the CORS headers of the app's
 * allow-list (resolveCorsOrigins, never the request's own origin) and starts a `: heartbeat` comment every
 * SSE_HEARTBEAT_INTERVAL_MS. `signal` is aborted when the client goes away before the stream ended. Ending
 * (`end`) or the client leaving stops the heartbeat, removes the helper's listener, and ends the response once; any
 * write after that is dropped. guardSseStream (RNX-171) creates it and hands it to the route.
 */
export class SseStream {
  private readonly disconnect = new AbortController();
  private readonly heartbeatIntervalMs: number;
  private heartbeat: NodeJS.Timeout | undefined;
  private isFinished = false;

  constructor(
    private readonly response: ServerResponse,
    { heartbeatIntervalMs = SSE_HEARTBEAT_INTERVAL_MS }: SseStreamOptions = {},
  ) {
    this.heartbeatIntervalMs = heartbeatIntervalMs;
  }

  /** Aborted when the client disconnects before the stream ended. */
  get signal(): AbortSignal {
    return this.disconnect.signal;
  }

  /** Writes status 200 with the SSE and CORS headers, then watches for the client leaving and starts the heartbeat. */
  open(): void {
    const cors = buildSseCorsHeaders({ origin: this.response.req?.headers.origin, allowedOrigins: resolveCorsOrigins(process.env) });
    this.response.writeHead(200, { ...SSE_HEADERS, ...cors });
    this.response.on("close", this.onClose);
    this.heartbeat = setInterval(() => this.writeComment("heartbeat"), this.heartbeatIntervalMs);
  }

  /** Writes text as it is (an event already in SSE form); dropped once the stream ended or the client left. */
  write(text: string): void {
    if (this.isFinished || this.response.destroyed) return;
    this.response.write(text);
  }

  /** Writes one `data:` event with `data` as its text (a JSON string, or `[DONE]`). */
  writeData(data: string): void {
    this.write(`data: ${data}\n\n`);
  }

  /** Writes one `data:` event with `payload` as JSON. */
  writeJson(payload: unknown): void {
    this.writeData(JSON.stringify(payload));
  }

  /** Writes one SSE comment (`: text`), which clients skip. */
  writeComment(text: string): void {
    this.write(`: ${text}\n\n`);
  }

  /** Stops the heartbeat, removes the listener and ends the response; only the first call (or the client leaving) counts. */
  end(): void {
    if (this.isFinished) return;
    this.finish();
    if (!this.response.writableEnded) this.response.end();
  }

  /** The response closed: when the stream had not ended, the client went away, so the signal is aborted. */
  private readonly onClose = (): void => {
    if (this.isFinished) return;
    this.finish();
    this.disconnect.abort();
  };

  /** Marks the stream finished, stops the heartbeat and removes the close listener. */
  private finish(): void {
    this.isFinished = true;
    clearInterval(this.heartbeat);
    this.response.off("close", this.onClose);
  }
}
