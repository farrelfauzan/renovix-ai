import { Logger } from "@nestjs/common";
import { NestFastifyApplication } from "@nestjs/platform-fastify";
import { request as httpRequest } from "node:http";
import { AddressInfo } from "node:net";

// RNX-171: what a client of an SSE route receives over a real socket, and every log line written meanwhile.

/** A finished SSE response read over a real socket: status, content type, the raw body and whether it ended. */
export interface SseResponse {
  statusCode: number;
  contentType: string | undefined;
  body: string;
  ended: boolean;
}

/**
 * Sends one request to the app over a real socket (the app listens on a random port of 127.0.0.1) and reads the
 * whole response. `ended` is false when the socket was cut before the response ended, or nothing arrived in 5 s.
 */
export async function requestOverSocket(
  app: NestFastifyApplication,
  options: { method: string; path: string; headers?: Record<string, string>; body?: unknown },
): Promise<SseResponse> {
  if (!app.getHttpServer().listening) await app.listen(0, "127.0.0.1");
  const { port } = app.getHttpServer().address() as AddressInfo;
  return new Promise<SseResponse>((resolve, reject) => {
    const client = httpRequest({
      host: "127.0.0.1",
      port,
      method: options.method,
      path: options.path,
      headers: { "content-type": "application/json", ...options.headers },
    });
    client.setTimeout(5000, () => client.destroy());
    client.on("error", reject);
    client.on("response", (response) => {
      let body = "";
      response.on("data", (chunk: Buffer) => (body += chunk.toString()));
      const finish = (ended: boolean) => () =>
        resolve({ statusCode: response.statusCode ?? 0, contentType: response.headers["content-type"], body, ended });
      response.on("end", finish(true));
      response.on("aborted", finish(false));
      response.on("error", finish(false));
    });
    client.end(options.body === undefined ? undefined : JSON.stringify(options.body));
  });
}

/** The `error.message` of every SSE error event in a response body. */
export const sseErrorMessages = (body: string): string[] =>
  body
    .split("\n\n")
    .map((event) => event.replace(/^data: /, ""))
    .filter((data) => data.startsWith('{"error"'))
    .map((data) => JSON.parse(data).error.message as string);

/**
 * RNX-16: every event of an SSE body, in order: a `data:` line's JSON parsed, `[DONE]` as the string "[DONE]", and
 * any other block (a `: heartbeat` comment) as written.
 */
export const sseEvents = (body: string): unknown[] =>
  body
    .split("\n\n")
    .filter((block) => block !== "")
    .map((block) => (block.startsWith("data: ") ? block.slice("data: ".length) : block))
    .map((data) => (data.startsWith("{") ? JSON.parse(data) : data));

/** A throw planted inside a route's own catch: the first `Logger.error` line that matches `when` throws `error`. */
export interface PlantedLoggerThrow {
  when: RegExp;
  error: Error;
}

/**
 * Captures every line written through Nest's Logger and the console (the spies are removed by
 * `jest.restoreAllMocks()`). With `planted`, the first matching `Logger.error` call throws instead of returning (it
 * is captured first): a route's catch logs before it writes its error event, so that throw escapes the route.
 */
export function captureLogs(planted?: PlantedLoggerThrow): { lines: string[]; wasPlantedThrown: () => boolean } {
  const lines: string[] = [];
  let pending = planted;
  const capture = (...args: unknown[]) =>
    void lines.push(args.map((a) => (a instanceof Error ? `${a.name}: ${a.message} ${a.stack}` : typeof a === "string" ? a : JSON.stringify(a))).join(" "));
  const error = (...args: unknown[]) => {
    capture(...args);
    if (!pending || !pending.when.test(String(args[0]))) return;
    const thrown = pending.error;
    pending = undefined;
    throw thrown;
  };
  for (const m of ["log", "warn", "debug", "verbose", "fatal"] as const) {
    jest.spyOn(Logger.prototype, m).mockImplementation(capture);
    jest.spyOn(Logger, m).mockImplementation(capture);
  }
  jest.spyOn(Logger.prototype, "error").mockImplementation(error);
  jest.spyOn(Logger, "error").mockImplementation(capture);
  for (const m of ["log", "warn", "error", "info", "debug"] as const) jest.spyOn(console, m).mockImplementation(capture);
  return { lines, wasPlantedThrown: () => planted !== undefined && pending === undefined };
}
