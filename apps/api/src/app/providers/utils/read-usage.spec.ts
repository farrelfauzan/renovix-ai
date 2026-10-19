import { readUsage } from "./read-usage";

// RX-22: OpenRouter's usage object (prompt_tokens includes prompt_tokens_details.cached_tokens).
describe("readUsage", () => {
  it("maps the cached tokens", () => {
    expect(
      readUsage({ prompt_tokens: 10339, completion_tokens: 60, total_tokens: 10399, prompt_tokens_details: { cached_tokens: 10318 } }),
    ).toEqual({ prompt_tokens: 10339, completion_tokens: 60, total_tokens: 10399, cachedTokens: 10318 });
  });

  it("0 cached tokens when the provider reports none", () => {
    expect(readUsage({ prompt_tokens: 3, completion_tokens: 2, total_tokens: 5 })).toEqual({
      prompt_tokens: 3,
      completion_tokens: 2,
      total_tokens: 5,
      cachedTokens: 0,
    });
  });

  it.each([undefined, null, "x"])("no usage object -> undefined (%p)", (usage) => {
    expect(readUsage(usage)).toBeUndefined();
  });
});
