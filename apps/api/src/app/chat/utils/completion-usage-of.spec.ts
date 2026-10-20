import { completionUsageOf } from "./completion-usage-of";

describe("RNX-196: completionUsageOf (the usage chunk from the ledger entry's tokens)", () => {
  it("prompt = new + cached input, cached as prompt_tokens_details, completion = output", () => {
    const actual = completionUsageOf({ tokensNew: 25, tokensCached: 15, tokensOut: 6 });

    expect(actual).toEqual({ prompt_tokens: 40, completion_tokens: 6, total_tokens: 46, prompt_tokens_details: { cached_tokens: 15 } });
  });

  it("null token counts count as 0", () => {
    const actual = completionUsageOf({ tokensNew: null, tokensCached: null, tokensOut: null });

    expect(actual).toEqual({ prompt_tokens: 0, completion_tokens: 0, total_tokens: 0, prompt_tokens_details: { cached_tokens: 0 } });
  });
});
