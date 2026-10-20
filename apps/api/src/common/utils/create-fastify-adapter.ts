import { randomUUID } from "node:crypto";
import { FastifyAdapter } from "@nestjs/platform-fastify";

/**
 * RX-166: the one Fastify adapter definition shared by `main.ts` and the test app.
 * Every request id is a random UUID, unique across instances and restarts (the
 * default `req-N` counter restarts per process, and RX-97 stores it on audit rows).
 * The id is never taken from a header (`requestIdHeader: false`).
 */
export function createFastifyAdapter(options: { readonly bodyLimit?: number } = {}): FastifyAdapter {
  return new FastifyAdapter({ ...options, genReqId: () => randomUUID(), requestIdHeader: false });
}
