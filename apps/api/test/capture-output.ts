import { format } from "node:util";

/**
 * RNX-190: every line the process prints meanwhile, as it is printed. Nest's Logger is not mocked: its ConsoleLogger
 * writes to process.stdout and process.stderr, and formats an Error argument with util.inspect, own properties
 * included (as Nest's ExceptionsHandler does with an error a route did not catch). Console calls are formatted the
 * way Node formats them. The spies are removed by `jest.restoreAllMocks()`.
 */
export function captureOutput(): { lines: string[] } {
  const lines: string[] = [];
  const write = ((chunk: unknown) => {
    lines.push(String(chunk));
    return true;
  }) as typeof process.stdout.write;
  jest.spyOn(process.stdout, "write").mockImplementation(write);
  jest.spyOn(process.stderr, "write").mockImplementation(write);
  for (const m of ["log", "warn", "error", "info", "debug"] as const) {
    jest.spyOn(console, m).mockImplementation((...args: unknown[]) => void lines.push(format(...args)));
  }
  return { lines };
}
