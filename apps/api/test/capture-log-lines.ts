import { Logger } from "@nestjs/common";
import { format } from "node:util";

const LOGGER_LEVELS = ["log", "error", "warn", "debug", "verbose", "fatal"] as const;
const CONSOLE_LEVELS = ["log", "info", "warn", "error", "debug"] as const;

/**
 * RNX-217: every line written meanwhile to the Nest Logger (each level, instance and static, whatever level is
 * enabled), the console, stdout and stderr, formatted the way Node formats it. Nothing is printed. The spies are
 * removed by `jest.restoreAllMocks()`.
 */
export function captureLogLines(): { lines: string[] } {
  const lines: string[] = [];
  const keep = (...args: unknown[]): void => void lines.push(format(...args));
  const write = ((chunk: unknown) => {
    lines.push(String(chunk));
    return true;
  }) as typeof process.stdout.write;
  for (const level of LOGGER_LEVELS) {
    jest.spyOn(Logger.prototype, level).mockImplementation(keep);
    jest.spyOn(Logger, level).mockImplementation(keep);
  }
  for (const level of CONSOLE_LEVELS) jest.spyOn(console, level).mockImplementation(keep);
  jest.spyOn(process.stdout, "write").mockImplementation(write);
  jest.spyOn(process.stderr, "write").mockImplementation(write);
  return { lines };
}
