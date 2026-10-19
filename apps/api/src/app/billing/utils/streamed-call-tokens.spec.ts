import { streamedCallTokens } from "./streamed-call-tokens";

// RX-22 (D202-5, D205): the provider's usage when it arrived, else ceil(characters / 4) of the prompt sent and of the
// output received.
describe("streamedCallTokens", () => {
  it("uses the usage chunk when one arrived", () => {
    const usage = { prompt_tokens: 100, completion_tokens: 7, total_tokens: 107, cachedTokens: 30 };

    expect(streamedCallTokens(usage, "ignored", "ignored")).toEqual({ tokensNew: 70, tokensCached: 30, tokensOut: 7 });
  });

  it("without usage: the prompt sent as new input and the output received so far, each ceil(characters / 4)", () => {
    expect(streamedCallTokens(undefined, "userHi", "Hello")).toEqual({ tokensNew: 2, tokensCached: 0, tokensOut: 2 });
  });
});
