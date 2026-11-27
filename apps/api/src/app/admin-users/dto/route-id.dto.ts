import { z } from "zod";

/** Longest id accepted in a route path (user and session ids are UUIDs). */
const MAX_ID_LENGTH = 64;

/** A user or session id in the path of an RNX-100 route: 1 to 64 characters. */
export const RouteIdDto = z.string().min(1).max(MAX_ID_LENGTH);
export type RouteIdDto = z.infer<typeof RouteIdDto>;
