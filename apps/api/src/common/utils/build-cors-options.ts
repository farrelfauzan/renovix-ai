import type { CorsOptions } from "@nestjs/common/interfaces/external/cors-options.interface";
import { resolveCorsOrigins } from "./resolve-cors-origins";

/** The methods a cross-origin request may use. */
const CORS_METHODS: readonly string[] = ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"];

/** The request headers a cross-origin request may send. */
const CORS_ALLOWED_HEADERS: readonly string[] = ["Content-Type", "Authorization", "X-Portal-Session"];

/**
 * The API's CORS options, given to NestFactory.create by main.ts (RNX-70: one definition, also used by the tests).
 * With NODE_ENV=development every origin is reflected; otherwise only `resolveCorsOrigins(env)`, which throws outside
 * development and test when CORS_ORIGIN is missing or invalid, so main.ts calls this before anything starts.
 * Credentials (cookies) are allowed, so the origin list must never be every origin in production.
 */
export function buildCorsOptions(env: NodeJS.ProcessEnv): CorsOptions {
  const isDev = env.NODE_ENV === "development";
  return {
    origin: isDev ? true : resolveCorsOrigins(env),
    methods: [...CORS_METHODS],
    allowedHeaders: [...CORS_ALLOWED_HEADERS],
    credentials: true,
  };
}
