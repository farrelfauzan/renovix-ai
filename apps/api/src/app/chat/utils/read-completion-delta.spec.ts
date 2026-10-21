import { readCompletionDelta } from "./read-completion-delta";
import { ProviderStreamError } from "../../providers/errors/provider-stream-error";

describe("RNX-196: readCompletionDelta (what one provider stream payload adds to a streamed answer)", () => {
  it("a content delta → its text, no finish reason, no usage", () => {
    const actual = readCompletionDelta(JSON.stringify({ choices: [{ index: 0, delta: { content: "Hel" }, finish_reason: null }] }));

    expect(actual).toEqual({ content: "Hel", finishReason: undefined, usage: undefined });
  });

  it("the usage chunk → its finish reason and usage, cached input from prompt_tokens_details", () => {
    const inputPayload = JSON.stringify({
      choices: [{ index: 0, delta: { content: "" }, finish_reason: "stop" }],
      usage: { prompt_tokens: 40, completion_tokens: 6, total_tokens: 46, prompt_tokens_details: { cached_tokens: 15 } },
    });

    const actual = readCompletionDelta(inputPayload);

    expect(actual).toEqual({
      content: undefined,
      finishReason: "stop",
      usage: { prompt_tokens: 40, completion_tokens: 6, total_tokens: 46, cachedTokens: 15 },
    });
  });

  it.each(["not json", "null", "42"])("an unparseable or non-object payload (%s) adds nothing", (inputPayload) => {
    expect(readCompletionDelta(inputPayload)).toEqual({});
  });

  it("a mid-stream error chunk → throws the provider's ProviderStreamError with its status only (never its text)", () => {
    const inputPayload = JSON.stringify({
      error: { code: 429, message: "RNX196-MARKER" },
      choices: [{ index: 0, delta: { content: "" }, finish_reason: "error" }],
    });

    let actual: unknown;
    try {
      readCompletionDelta(inputPayload);
    } catch (error) {
      actual = error;
    }

    expect(actual).toBeInstanceOf(ProviderStreamError);
    expect(actual).toMatchObject({ status: 429, message: "Provider stream error" });
  });

  it("RNX-162: the usage chunk's reported cost and reasoning tokens", () => {
    const inputPayload = JSON.stringify({
      choices: [],
      usage: { prompt_tokens: 40, completion_tokens: 6, total_tokens: 46, cost: 0.00042, completion_tokens_details: { reasoning_tokens: 4 } },
    });

    const actual = readCompletionDelta(inputPayload).usage;

    expect([actual?.costUsd?.toString(), actual?.reasoningTokens]).toEqual(["0.00042", 4]);
  });
});
