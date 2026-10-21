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

  // RX-22 review: a count that is not a whole number from 0 to 2^31 - 1 makes the report untrusted (no usage).
  it.each([
    ["NaN prompt", { prompt_tokens: NaN, completion_tokens: 1 }],
    ["negative completion", { prompt_tokens: 10, completion_tokens: -1 }],
    ["fractional prompt", { prompt_tokens: 10.5, completion_tokens: 1 }],
    ["string prompt", { prompt_tokens: "10", completion_tokens: 1 }],
    ["huge completion", { prompt_tokens: 10, completion_tokens: 2 ** 31 }],
    ["Infinity prompt", { prompt_tokens: Infinity, completion_tokens: 1 }],
    ["missing completion", { prompt_tokens: 10 }],
    ["negative cached", { prompt_tokens: 10, completion_tokens: 1, prompt_tokens_details: { cached_tokens: -5 } }],
    ["string cached", { prompt_tokens: 10, completion_tokens: 1, prompt_tokens_details: { cached_tokens: "5" } }],
  ])("%s -> undefined", (_case, usage) => {
    expect(readUsage(usage)).toBeUndefined();
  });

  it("clamps cached to prompt_tokens and fills a bad total from prompt + completion", () => {
    expect(readUsage({ prompt_tokens: 10, completion_tokens: 2, total_tokens: -1, prompt_tokens_details: { cached_tokens: 50 } })).toEqual({
      prompt_tokens: 10,
      completion_tokens: 2,
      total_tokens: 12,
      cachedTokens: 10,
    });
  });

  // RNX-162: OpenRouter's reported cost (USD) and reasoning tokens, on the JSON answer and the stream's usage chunk alike.
  it("maps the reported cost (as a Decimal) and the reasoning tokens", () => {
    const actual = readUsage({ prompt_tokens: 10, completion_tokens: 50, total_tokens: 60, cost: 0.1, completion_tokens_details: { reasoning_tokens: 30 } });

    expect(actual?.costUsd?.toString()).toBe("0.1");
    expect(actual?.reasoningTokens).toBe(30);
  });

  it("a reported cost of 0 is kept", () => {
    expect(readUsage({ prompt_tokens: 1, completion_tokens: 1, cost: 0 })?.costUsd?.toString()).toBe("0");
  });

  it.each([
    ["a negative cost", { cost: -0.1 }],
    ["a string cost", { cost: "0.1" }],
    ["a NaN cost", { cost: NaN }],
    ["fractional reasoning tokens", { completion_tokens_details: { reasoning_tokens: 1.5 } }],
    ["string reasoning tokens", { completion_tokens_details: { reasoning_tokens: "3" } }],
  ])("%s is left out, the token counts kept", (_case, extra) => {
    expect(readUsage({ prompt_tokens: 3, completion_tokens: 2, total_tokens: 5, ...extra })).toStrictEqual({
      prompt_tokens: 3,
      completion_tokens: 2,
      total_tokens: 5,
      cachedTokens: 0,
    });
  });
});
