import { readStreamError } from "./read-stream-error";

// RX-22: OpenRouter's mid-stream error (HTTP 200): a top-level `error` and finish_reason "error".
describe("readStreamError", () => {
  it("a chunk with a top-level error is a provider error with its code as the status", () => {
    const chunk = {
      id: "gen-1",
      error: { code: 429, message: "Rate limit exceeded" },
      choices: [{ index: 0, delta: { content: "" }, finish_reason: "error" }],
    };

    expect(readStreamError(chunk)).toMatchObject({ status: 429, bodyText: '{"code":429,"message":"Rate limit exceeded"}' });
  });

  it("a non-numeric code (server_error) becomes 502", () => {
    expect(readStreamError({ error: { code: "server_error", message: "Provider disconnected" } })?.status).toBe(502);
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
