import { countCharTokens } from "./count-char-tokens";

// RX-22 (D205): the charged local count is ceil(code points / 4), not bytes and not UTF-16 code units.
describe("countCharTokens", () => {
  it.each([
    ["", 0],
    ["Hi", 1],
    ["Hell", 1],
    ["Hello", 2],
    ["你好你好你", 2],
    ["👍👍👍👍", 1],
  ])("%j -> %d", (text, expected) => {
    expect(countCharTokens(text)).toBe(expected);
  });
});
