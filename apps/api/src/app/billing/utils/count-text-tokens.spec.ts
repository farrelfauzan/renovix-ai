import { countTextTokens } from "./count-text-tokens";

// RX-22 (D205): the hold estimate's count is the UTF-8 byte length, never below a byte-level tokenizer's count.
describe("countTextTokens", () => {
  it.each([
    ["", 0],
    ["Hello", 5],
    ["héllo", 6],
    ["你好", 6],
    ["👍", 4],
  ])("%j -> %d", (text, expected) => {
    expect(countTextTokens(text)).toBe(expected);
  });
});
