import type { LoggedRequest } from "../types/logged-request";
import { requestLogStorage } from "./request-log-storage";

/**
 * RNX-17: a Fastify `preHandler` hook. The route handler (Nest's guards, interceptors, controller, exception filter)
 * runs inside `requestLogStorage`, so every log line it writes carries this request. It is a `preHandler` hook, not
 * `onRequest`, because the body is parsed between the two on stream events that would leave the stored context.
 * Typed by what it reads, not with fastify's types: two fastify versions are installed (the root's and Nest's).
 */
export function bindRequestLogContext(request: LoggedRequest, _reply: unknown, done: () => void): void {
  requestLogStorage.run(request, done);
}
