import { ConsoleLogger, LogLevel } from "@nestjs/common";
import type { JsonLogObject } from "../types/json-log-object";
import type { JsonLogOptions } from "../types/json-log-options";
import { LOG_SEVERITY } from "../utils/log-severity";
import { maskSecrets } from "../utils/mask-secrets";
import { readRequestLogFields } from "../utils/read-request-log-fields";

/**
 * RNX-17: the API's logger (main.ts). Nest's ConsoleLogger, so `Logger` instance and static calls still go through
 * Nest's `Logger` class, plus three things every line gets whatever the call site passed:
 * - secrets masked (`maskSecrets`) in the message, every object or error argument, the context and the stack;
 * - `severity` (RNX-233, Cloud Logging's field) next to `level` on every JSON line;
 * - while a request is handled: its id, route pattern, and account (or admin) once a guard has attached it, as
 *   JSON fields (`json: true`) or in brackets after the context (the readable dev format).
 */
export class AppLogger extends ConsoleLogger {
  protected override printMessages(
    messages: unknown[],
    context?: string,
    logLevel?: LogLevel,
    writeStreamType?: "stdout" | "stderr",
    errorStack?: unknown,
  ): void {
    super.printMessages(
      messages.map(maskSecrets),
      context === undefined ? undefined : String(maskSecrets(context)),
      logLevel,
      writeStreamType,
      maskSecrets(errorStack),
    );
  }

  protected override printStackTrace(stack: string): void {
    super.printStackTrace(stack && String(maskSecrets(stack)));
  }

  protected override getJsonLogObject(
    message: unknown,
    options: JsonLogOptions,
  ): JsonLogObject {
    const line = super.getJsonLogObject(message, options);
    return { ...line, severity: LOG_SEVERITY[line.level], ...readRequestLogFields() };
  }

  protected override formatContext(context: string): string {
    const fields = readRequestLogFields();
    const request = fields
      ? `[${[fields.requestId, fields.route, fields.accountId ?? fields.adminId].filter(Boolean).join(" ")}] `
      : "";
    return `${super.formatContext(context)}${request}`;
  }
}
