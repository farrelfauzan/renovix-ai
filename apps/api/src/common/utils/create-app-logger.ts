import type { LogLevel } from "@nestjs/common";
import { AppLogger } from "../logger/app-logger";

const DEV_LOG_LEVELS: readonly LogLevel[] = ["debug", "error", "warn", "verbose", "log"];
const LOG_LEVELS: readonly LogLevel[] = ["error", "warn"];

/**
 * RNX-17: the logger main.ts starts the API with. Levels as before (all in development, errors and warnings
 * otherwise); the format follows NODE_ENV too: one JSON object per line, except with NODE_ENV=development, which
 * keeps Nest's readable format.
 */
export function createAppLogger(env: NodeJS.ProcessEnv): AppLogger {
  const isDev = env.NODE_ENV === "development";
  return new AppLogger({ json: !isDev, logLevels: [...(isDev ? DEV_LOG_LEVELS : LOG_LEVELS)] });
}
