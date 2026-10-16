import { GowaService } from "./gowa.service";

describe("RX-131: splitMessage (a long WhatsApp reply split into parts of at most maxLength)", () => {
  it.each([
    { name: "short text is one part", text: "hello", maxLength: 10, expected: ["hello"] },
    { name: "exactly maxLength is one part", text: "abcdefghij", maxLength: 10, expected: ["abcdefghij"] },
    { name: "empty text is one empty part", text: "", maxLength: 10, expected: [""] },
    { name: "split at a paragraph, the next part's leading space trimmed", text: "aaaaaaaaaaaa\n\nbbbbbbbbbbbb", maxLength: 20, expected: ["aaaaaaaaaaaa", "bbbbbbbbbbbb"] },
    { name: "split at a sentence: the period starts the next part (today's behaviour)", text: "First part here. Second part is longer", maxLength: 20, expected: ["First part here", ". Second part is", "longer"] },
    { name: "split at a word", text: "alpha beta gamma", maxLength: 10, expected: ["alpha beta", "gamma"] },
    { name: "no boundary: cut at maxLength", text: "abcdefghijklmnopqrstuvwxy", maxLength: 10, expected: ["abcdefghij", "klmnopqrst", "uvwxy"] },
    { name: "a boundary before 30% of maxLength is not used", text: "a bcdefghijklmn", maxLength: 10, expected: ["a bcdefghi", "jklmn"] },
    { name: "a paragraph before half of maxLength falls back to a word", text: "ab\n\ncdefghijklmnop qrstuvwxyz", maxLength: 20, expected: ["ab\n\ncdefghijklmnop", "qrstuvwxyz"] },
  ])("$name", ({ text, maxLength, expected }) => {
    const actual = GowaService.prototype["splitMessage"](text, maxLength);

    expect(actual).toEqual(expected);
  });
});
