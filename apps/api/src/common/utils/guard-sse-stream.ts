import type { LoggerService } from "@nestjs/common";
import type { ServerResponse } from "node:http";
import { errorName } from "./error-name";
import { codedRefusalOf } from "./coded-refusal-of";

const STREAM_FAILED_EVENT = `data: ${JSON.stringify({ error: { message: "The response failed. Please try again." } })}\n\n`;

/**
 * RNX-171: the last-resort wrapper of every SSE route. Runs the route's work; an error that escapes it before the
 * route wrote its headers is rethrown (Nest answers it as before), and an error after the headers ends only that
 * stream: it is logged by its name only (never its message, which may carry provider text or a secret), the fixed
 * error event is written while the socket can still take it, and the response is ended. Nothing is handed back to
 * Fastify, which would write the headers a second time. RNX-200: a refusal of ours with a code (402
 * CREDITS_EXHAUSTED, RUN_CAP_EXCEEDED) is sent with its own message and code instead of the fixed text.
 */
export async function guardSseStream({
  response,
  logger,
  stream,
}: {
  response: ServerResponse;
  logger: LoggerService;
  stream: () => Promise<void>;
}): Promise<void> {
  try {
    await stream();
  } catch (error) {
    if (!response.headersSent) throw error;
    logger.error(`SSE stream ended by an error after its headers were sent (${errorName(error)})`);
    if (response.writableEnded) return;
    const refusal = codedRefusalOf(error);
    if (!response.destroyed) response.write(refusal ? `data: ${JSON.stringify({ error: refusal })}\n\n` : STREAM_FAILED_EVENT);
    response.end();
  }
}
