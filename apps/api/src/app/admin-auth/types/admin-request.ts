import type { FastifyRequest } from "fastify";
import type { AdminIdentity } from "./admin-identity";

/** A request on a `staff` route, after `AccessGuard` accepted it. */
export type AdminRequest = FastifyRequest & { admin: AdminIdentity };
