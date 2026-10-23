import { captureOutput } from "../../../test/capture-output";
import { handleFatalStart } from "./handle-fatal-start";
import { resolveCorsOrigins } from "./resolve-cors-origins";

describe("RX-156 / D141: resolveCorsOrigins", () => {
  it("adds ADMIN_ORIGIN to the listed product origins", () => {
    const inputEnv = { CORS_ORIGIN: "https://chat.renovix.id, https://renovix.id", ADMIN_ORIGIN: "https://admin.renovix.id" };

    const actualOrigins = resolveCorsOrigins(inputEnv);

    expect(actualOrigins).toEqual(["https://chat.renovix.id", "https://renovix.id", "https://admin.renovix.id"]);
  });

  it("does not list ADMIN_ORIGIN twice", () => {
    const inputEnv = { CORS_ORIGIN: "https://chat.renovix.id,https://admin.renovix.id", ADMIN_ORIGIN: "https://admin.renovix.id" };

    expect(resolveCorsOrigins(inputEnv)).toEqual(["https://chat.renovix.id", "https://admin.renovix.id"]);
  });

  it("control: a list without ADMIN_ORIGIN stays as it is", () => {
    expect(resolveCorsOrigins({ CORS_ORIGIN: "https://chat.renovix.id" })).toEqual(["https://chat.renovix.id"]);
  });

  it.each(["development", "test"])(
    "control (RNX-70 AC3): with NODE_ENV=%s and no CORS_ORIGIN every origin is accepted, as before",
    (inputNodeEnv) => {
      expect(resolveCorsOrigins({ NODE_ENV: inputNodeEnv, ADMIN_ORIGIN: "https://admin.renovix.id" })).toBe(true);
    },
  );

  it("negative: an origin that is neither listed nor ADMIN_ORIGIN is not accepted", () => {
    const actualOrigins = resolveCorsOrigins({ CORS_ORIGIN: "https://chat.renovix.id", ADMIN_ORIGIN: "https://admin.renovix.id" });

    expect(actualOrigins).not.toContain("https://evil.example");
  });
});

describe("RNX-70: outside development and test CORS_ORIGIN is required and must list origins", () => {
  const ADMIN_ORIGIN = "https://admin.example.test";
  const MISSING_MESSAGE = "CORS_ORIGIN is required outside development and test and lists no origin";

  afterEach(() => jest.restoreAllMocks());

  it.each([
    ["missing in production", { NODE_ENV: "production" }],
    ["empty in production", { NODE_ENV: "production", CORS_ORIGIN: "" }],
    ["only separators in production", { NODE_ENV: "production", CORS_ORIGIN: "  ,  " }],
    ["missing with NODE_ENV unset", {}],
  ])("AC1 negative: %s refuses to start, naming CORS_ORIGIN", (_label, inputEnv) => {
    expect(() => resolveCorsOrigins({ ...inputEnv, ADMIN_ORIGIN })).toThrow(MISSING_MESSAGE);
  });

  it.each([
    "*",
    "https://*.example.test",
    "https://chat.example.test/",
    "https://chat.example.test/path",
    "https://chat.example.test?x=1",
    "chat.example.test",
    "ftp://x.test",
    "http://chat.example.test",
  ])("AC1b negative: the entry %p refuses to start, naming the entry", (inputEntry) => {
    const inputEnv = { NODE_ENV: "production", CORS_ORIGIN: `https://ok.example.test,${inputEntry}`, ADMIN_ORIGIN };

    expect(() => resolveCorsOrigins(inputEnv)).toThrow(`CORS_ORIGIN entry "${inputEntry}" is not an origin`);
  });

  it.each([
    ["https://chat.example.test", ["https://chat.example.test"]],
    ["https://a.test,https://b.test:8443", ["https://a.test", "https://b.test:8443"]],
    ["http://localhost:3000", ["http://localhost:3000"]],
    ["http://127.0.0.1:3000", ["http://127.0.0.1:3000"]],
  ])("AC1b control: %p is accepted in production", (inputCorsOrigin, expectedListed) => {
    const actualOrigins = resolveCorsOrigins({ NODE_ENV: "production", CORS_ORIGIN: inputCorsOrigin, ADMIN_ORIGIN });

    expect(actualOrigins).toEqual([...expectedListed, ADMIN_ORIGIN]);
  });

  it("AC1: the refusal reaches handleFatalStart as one JSON line naming CORS_ORIGIN, and the process exits with 1", () => {
    const inputEnv = { NODE_ENV: "production", ADMIN_ORIGIN };
    const { lines } = captureOutput();
    const mockExit = jest.fn();

    try {
      resolveCorsOrigins(inputEnv);
    } catch (err) {
      handleFatalStart({ err, env: inputEnv, exit: mockExit });
    }

    const actualLines = lines.join("").split("\n").filter(Boolean);
    expect(actualLines).toHaveLength(1);
    expect(JSON.parse(actualLines[0])).toMatchObject({ level: "error", severity: "ERROR" });
    expect(actualLines[0]).toContain(MISSING_MESSAGE);
    expect(mockExit).toHaveBeenCalledWith(1);
  });
});
