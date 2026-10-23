import type { FastifyRequest } from "fastify";

/** A request on a `session` route after AccessGuard accepted it: the signed-in user's id (RNX-35). */
export type SignedInRequest = FastifyRequest & { readonly user: { readonly userId: string } };
