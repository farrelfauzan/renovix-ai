import { randomUUID } from "node:crypto";
import { FastifyAdapter } from "@nestjs/platform-fastify";
import { bindRequestLogContext } from "./bind-request-log-context";

/**
 * RX-166: the one Fastify adapter definition shared by `main.ts` and the test app.
 * Every request id is a random UUID, unique across instances and restarts (the
 * default `req-N` counter restarts per process, and RX-97 stores it on audit rows).
 * The id is never taken from a header (`requestIdHeader: false`).
 * RNX-17: every route handler runs inside the request's log context (`bindRequestLogContext`).
 */
export function createFastifyAdapter(options: { readonly bodyLimit?: number } = {}): FastifyAdapter {
  const adapter = new FastifyAdapter({ ...options, genReqId: () => randomUUID(), requestIdHeader: false });
  adapter.getInstance().addHook("preHandler", bindRequestLogContext);
  return adapter;
}
