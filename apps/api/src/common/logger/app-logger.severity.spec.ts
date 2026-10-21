import type { LogLevel } from "@nestjs/common";
import { captureOutput } from "../../../test/capture-output";
import { AppLogger } from "./app-logger";

// RNX-233 AC1-3: every JSON line carries Cloud Logging's `severity` next to Nest's `level`; the readable format has none.
const ALL_LEVELS: LogLevel[] = ["log", "error", "warn", "debug", "verbose", "fatal"];

describe("RNX-233: AppLogger severity", () => {
  afterEach(() => jest.restoreAllMocks());

  it("AC1: an error logged in JSON mode has severity ERROR and level error", () => {
    const { lines } = captureOutput();
    const inputLogger = new AppLogger({ json: true, logLevels: ALL_LEVELS });

    inputLogger.error("boom");

    const actualLine = JSON.parse(lines.join(""));
    expect(actualLine).toMatchObject({ level: "error", severity: "ERROR", message: "boom" });
  });

  it.each([
    ["fatal", "CRITICAL"],
    ["error", "ERROR"],
    ["warn", "WARNING"],
    ["log", "INFO"],
    ["debug", "DEBUG"],
    ["verbose", "DEBUG"],
  ] as const)("AC2: level %s gives severity %s", (inputLevel, expectedSeverity) => {
    const { lines } = captureOutput();
    const inputLogger = new AppLogger({ json: true, logLevels: ALL_LEVELS });

    inputLogger[inputLevel]("hello");

    const actualLine = JSON.parse(lines.join(""));
    expect(actualLine).toMatchObject({ level: inputLevel, severity: expectedSeverity });
  });

  it("AC3: the readable development format is unchanged and has no severity", () => {
    const { lines } = captureOutput();
    const inputLogger = new AppLogger({ json: false, logLevels: ALL_LEVELS });

    inputLogger.error("boom");

    const actualOutput = lines.join("");
    expect(actualOutput).toContain("ERROR");
    expect(actualOutput).toContain("boom");
    expect(actualOutput).not.toContain("severity");
    expect(actualOutput).not.toContain("{");
  });
});
