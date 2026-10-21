import { captureOutput } from "../../../test/capture-output";
import { handleFatalStart } from "./handle-fatal-start";

// RNX-233 AC4-5: a startup failure goes through the API's logger, masked, and the process exits with 1.
const PLANTED_TOKEN = "plantedtoken0123456789abcdef";
const PLANTED_PASSWORD = "planted-pass";
const buildStartupError = (): Error =>
  new Error(`Auth failed with Bearer ${PLANTED_TOKEN} for postgresql://user:${PLANTED_PASSWORD}@host/db`);

describe("RNX-233: handleFatalStart", () => {
  afterEach(() => jest.restoreAllMocks());

  it("AC4: in production it writes one masked JSON line with severity and level, and exits with 1", () => {
    const { lines } = captureOutput();
    const mockExit = jest.fn();

    handleFatalStart({ err: buildStartupError(), env: { NODE_ENV: "production" }, exit: mockExit });

    const actualOutput = lines.join("");
    const actualLines = actualOutput.split("\n").filter(Boolean);
    expect(actualLines).toHaveLength(1);
    expect(JSON.parse(actualLines[0])).toMatchObject({ level: "error", severity: "ERROR" });
    expect(actualOutput).toContain("[REDACTED]");
    expect(actualOutput).not.toContain(PLANTED_TOKEN);
    expect(actualOutput).not.toContain(PLANTED_PASSWORD);
    expect(mockExit).toHaveBeenCalledWith(1);
  });

  it("AC5: in development it prints Nest's readable format, masked, and exits with 1", () => {
    const { lines } = captureOutput();
    const mockExit = jest.fn();

    handleFatalStart({ err: buildStartupError(), env: { NODE_ENV: "development" }, exit: mockExit });

    const actualOutput = lines.join("");
    expect(actualOutput).toContain("[Bootstrap]");
    expect(actualOutput).toContain("[REDACTED]");
    expect(actualOutput).not.toContain(PLANTED_TOKEN);
    expect(actualOutput).not.toContain(PLANTED_PASSWORD);
    expect(actualOutput).not.toContain("\"severity\"");
    expect(mockExit).toHaveBeenCalledWith(1);
  });
});
