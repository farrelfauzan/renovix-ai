import type { LogLevel } from "@nestjs/common";

/** RNX-17: what Nest's ConsoleLogger passes to `getJsonLogObject` (its own type is not exported). */
export interface JsonLogOptions {
  context: string;
  logLevel: LogLevel;
  writeStreamType?: "stdout" | "stderr";
  errorStack?: unknown;
}
