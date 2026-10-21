import type { LogLevel } from "@nestjs/common";

/** RNX-233: Cloud Logging's `severity` for each of Nest's log levels; JSON log lines carry it next to `level`. */
export const LOG_SEVERITY: Readonly<Record<LogLevel, string>> = {
  fatal: "CRITICAL",
  error: "ERROR",
  warn: "WARNING",
  log: "INFO",
  debug: "DEBUG",
  verbose: "DEBUG",
};
