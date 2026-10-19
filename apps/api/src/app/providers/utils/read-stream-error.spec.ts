import { readStreamError } from "./read-stream-error";
import { ProviderStreamError } from "../errors/provider-stream-error";

// RX-22: OpenRouter's mid-stream error (HTTP 200): a top-level `error` and finish_reason "error".
describe("readStreamError", () => {
  it("a chunk with a top-level error is a provider stream error with only its code; the provider text is not kept", () => {
    const chunk = {
      id: "gen-1",
      error: { code: 429, message: "RX22-MARKER Rate limit exceeded" },
      choices: [{ index: 0, delta: { content: "" }, finish_reason: "error" }],
    };

    const actual = readStreamError(chunk);

    expect(actual).toBeInstanceOf(ProviderStreamError);
    expect(actual?.status).toBe(429);
    expect(JSON.stringify({ ...actual, message: actual?.message, stack: actual?.stack })).not.toContain("RX22-MARKER");
  });

  it.each([["server_error"], [200], [700], [undefined]])("a code that is not an HTTP error status (%p) becomes 502", (code) => {
    expect(readStreamError({ error: { code, message: "x" } })?.status).toBe(502);
  });

  it("finish_reason error alone is a provider error too", () => {
    expect(readStreamError({ choices: [{ delta: {}, finish_reason: "error" }] })?.status).toBe(502);
  });

  it.each([
    { choices: [{ delta: { content: "Hi" } }] },
    { choices: [{ delta: {}, finish_reason: "stop" }], usage: { prompt_tokens: 1 } },
  ])("a normal chunk is not an error", (chunk) => {
    expect(readStreamError(chunk)).toBeUndefined();
  });
});
