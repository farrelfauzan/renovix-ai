import { pickFreeSlug } from "./pick-free-slug";

describe("RNX-126: pickFreeSlug", () => {
  it.each([
    { name: "a free slug is kept", inputTaken: ["other", "bot-1"], expected: "bot" },
    { name: "a taken slug gets the first free suffix", inputTaken: ["bot"], expected: "bot-1" },
    { name: "taken suffixes are skipped", inputTaken: ["bot", "bot-1", "bot-2"], expected: "bot-3" },
    { name: "a gap is used", inputTaken: ["bot", "bot-2"], expected: "bot-1" },
    { name: "a longer slug with the same start does not count", inputTaken: ["bot-helper"], expected: "bot" },
  ])("$name", ({ inputTaken, expected }) => {
    const actual = pickFreeSlug("bot", inputTaken);

    expect(actual).toBe(expected);
  });
});
