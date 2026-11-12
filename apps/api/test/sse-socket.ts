import { NestFastifyApplication } from "@nestjs/platform-fastify";
import { ClientRequest, IncomingHttpHeaders, IncomingMessage, request as httpRequest } from "node:http";
import { AddressInfo } from "node:net";

// RNX-42: an SSE response read over a real socket with its headers, and a client that goes away in the middle of one.

/** How long `isAbortedWithin` waits by default before answering false. */
const ABORT_WAIT_MS = 2000;

/** A request to an SSE route. */
type SseRequest = { method: string; path: string; headers?: Record<string, string>; body?: unknown };

/** Sends the request over a real socket (the app listens on a random port of 127.0.0.1) and returns the response. */
async function sendOverSocket(app: NestFastifyApplication, options: SseRequest): Promise<{ client: ClientRequest; response: IncomingMessage }> {
  if (!app.getHttpServer().listening) await app.listen(0, "127.0.0.1");
  const { port } = app.getHttpServer().address() as AddressInfo;
  const client = httpRequest({
    host: "127.0.0.1",
    port,
    method: options.method,
    path: options.path,
    headers: { "content-type": "application/json", ...options.headers },
  });
  client.on("error", () => undefined); // a test may destroy it on purpose
  client.end(options.body === undefined ? undefined : JSON.stringify(options.body));
  const response = await new Promise<IncomingMessage>((resolve) => client.on("response", resolve));
  return { client, response };
}

/** Sends one request over a real socket and reads the whole response: status, headers and body. */
export async function requestSse(
  app: NestFastifyApplication,
  options: SseRequest,
): Promise<{ statusCode: number; headers: IncomingHttpHeaders; body: string }> {
  const { response } = await sendOverSocket(app, options);
  let body = "";
  response.on("data", (chunk: Buffer) => (body += chunk.toString()));
  await new Promise<void>((ended) => response.on("end", () => ended()));
  return { statusCode: response.statusCode ?? 0, headers: response.headers, body };
}

/**
 * Sends one request to the app over a real socket (the app listens on a random port of 127.0.0.1), waits until the
 * response body contains `waitFor`, then destroys the client. Returns the response's status and headers.
 */
export async function disconnectAfter(
  app: NestFastifyApplication,
  options: SseRequest & { waitFor: string },
): Promise<{ statusCode: number; headers: IncomingHttpHeaders }> {
  const { client, response } = await sendOverSocket(app, options);
  await new Promise<void>((received) => {
    response.on("data", (chunk: Buffer) => chunk.toString().includes(options.waitFor) && received());
    response.on("end", () => received());
  });
  client.destroy();
  return { statusCode: response.statusCode ?? 0, headers: response.headers };
}

/** True once `signal` is aborted, false when it is still not aborted after `ms`. */
export function isAbortedWithin(signal: AbortSignal, ms = ABORT_WAIT_MS): Promise<boolean> {
  if (signal.aborted) return Promise.resolve(true);
  return new Promise<boolean>((resolve) => {
    const timer = setTimeout(() => resolve(false), ms);
    signal.addEventListener("abort", () => (clearTimeout(timer), resolve(true)), { once: true });
  });
}

/** The heartbeat timers of the SSE helper among the calls of a `setInterval` spy: those set with `intervalMs`. */
export function heartbeatTimersOf(setIntervalSpy: jest.SpyInstance, intervalMs: number): unknown[] {
  return setIntervalSpy.mock.calls.flatMap((call, i) => (call[1] === intervalMs ? [setIntervalSpy.mock.results[i].value] : []));
}
