import { ArgumentsHost, Catch, Logger } from "@nestjs/common";
import { BaseExceptionFilter } from "@nestjs/core";
import type { FastifyReply } from "fastify";
import type { ServerResponse } from "node:http";
import { errorName } from "../utils/error-name";

/**
 * RNX-171: the app's global exception filter (APP_FILTER in AppModule and in the test module). An error for a reply
 * whose headers are already sent (an SSE route writes them itself) is logged by its name only and that reply is
 * ended; nothing is written again, so Fastify never writes the headers a second time (ERR_HTTP_HEADERS_SENT). Every
 * other error goes to Nest's default handling, so status codes and bodies stay as they were.
 */
@Catch()
export class GlobalExceptionFilter extends BaseExceptionFilter {
  private readonly logger = new Logger(GlobalExceptionFilter.name);

  override catch(exception: unknown, host: ArgumentsHost): void {
    if (host.getType() !== "http") return super.catch(exception, host);
    const reply = host.switchToHttp().getResponse<FastifyReply | ServerResponse>();
    const raw = "raw" in reply ? reply.raw : reply;
    if (!raw.headersSent && !("sent" in reply && reply.sent === true)) return super.catch(exception, host);
    this.logger.error(`Error after the response was sent or its headers were written (${errorName(exception)})`);
    // Ended, so Fastify sees the reply as sent and does not send the route's result after it.
    if (raw.headersSent && !raw.writableEnded) raw.end();
  }
}
