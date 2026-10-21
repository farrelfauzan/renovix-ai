import type { HandleFatalStartInput } from "../types/handle-fatal-start-input";
import { createAppLogger } from "./create-app-logger";

/**
 * RNX-233: logs a startup failure through the API's own logger (masked, one JSON line outside development) and exits
 * with code 1. It builds its logger itself because startup often fails before the Nest app exists.
 */
export function handleFatalStart({ err, env, exit }: HandleFatalStartInput): void {
  createAppLogger(env).error(err, "Bootstrap");
  exit(1);
}
