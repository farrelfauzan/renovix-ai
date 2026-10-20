import { ArgumentsHost, BadRequestException, HttpServer } from "@nestjs/common";
import { IncomingMessage, ServerResponse } from "node:http";
import { Socket } from "node:net";
import { GlobalExceptionFilter } from "./global-exception.filter";
import { captureLogs } from "../../../test/sse-client";

// RNX-171 AC2 (unit): the filter given an error for a reply whose headers are already sent, and for one whose
// headers are not. The same filter on a real Fastify app: global-exception.headers-sent.spec.ts.

const MARKER_SECRET = "rnx171-marker-session-not-real";

describe("RNX-171 AC2: GlobalExceptionFilter (unit)", () => {
  afterEach(() => jest.restoreAllMocks());

  /** A real Node response whose SSE headers are already written, inside a Fastify-like reply. */
  const replyWithHeadersSent = () => {
    const raw = new ServerResponse(new IncomingMessage(new Socket()));
    raw.writeHead(200, { "Content-Type": "text/event-stream" });
    return { raw, sent: false };
  };

  const httpHost = (reply: unknown): ArgumentsHost =>
    ({
      getType: () => "http",
      getArgByIndex: (index: number) => (index === 1 ? reply : undefined),
      switchToHttp: () => ({ getResponse: () => reply }),
    }) as unknown as ArgumentsHost;

  const fakeAdapter = () =>
    ({ reply: jest.fn(), end: jest.fn(), isHeadersSent: jest.fn(() => false) }) as unknown as HttpServer & {
      reply: jest.Mock;
      end: jest.Mock;
    };

  it("headers already sent: no second writeHead, no reply through the adapter, the response is ended; the log names only the error class", () => {
    const { lines } = captureLogs();
    const reply = replyWithHeadersSent();
    const writeHead = jest.spyOn(reply.raw, "writeHead");
    const adapter = fakeAdapter();
    const filter = new GlobalExceptionFilter(adapter);

    filter.catch(new TypeError(`after the headers, cookie=${MARKER_SECRET}`), httpHost(reply));

    expect(writeHead).not.toHaveBeenCalled();
    expect(adapter.reply).not.toHaveBeenCalled();
    expect(reply.raw.writableEnded).toBe(true);
    expect(lines).toEqual(["Error after the response was sent or its headers were written (TypeError)"]);
    expect(lines.filter((l) => l.includes("ERR_HTTP_HEADERS_SENT") || l.includes(MARKER_SECRET))).toEqual([]);
  });

  it("headers not sent: Nest's default answer through the adapter, unchanged (status and body)", () => {
    const reply = { raw: new ServerResponse(new IncomingMessage(new Socket())), sent: false };
    const adapter = fakeAdapter();
    const filter = new GlobalExceptionFilter(adapter);

    filter.catch(new BadRequestException("Invalid request body"), httpHost(reply));

    expect(adapter.reply).toHaveBeenCalledWith(
      reply,
      { statusCode: 400, message: "Invalid request body", error: "Bad Request" },
      400,
    );
  });
});
