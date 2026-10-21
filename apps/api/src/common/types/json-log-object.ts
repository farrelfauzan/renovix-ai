import type { LogLevel } from "@nestjs/common";
import type { RequestLogFields } from "./request-log-fields";

/** RNX-17: one JSON log line: Nest's ConsoleLogger fields plus the request's (`RequestLogFields`) during a request. */
export interface JsonLogObject extends Partial<RequestLogFields> {
  level: LogLevel;
  severity: string;
  pid: number;
  timestamp: number;
  message: unknown;
  context?: string;
  stack?: unknown;
}
