import { maskKey } from "./mask-key";

describe("RX-130: maskKey (how much of a stored provider key is shown)", () => {
  it.each([
    { name: "empty value", value: "", expected: "" },
    { name: "1 character is hidden completely", value: "a", expected: "****" },
    { name: "8 characters are hidden completely", value: "abcdefgh", expected: "****" },
    { name: "9 characters show the first 4 and the last 3", value: "abcdefghi", expected: "abcd****ghi" },
    { name: "a long key shows the first 4 and the last 3 only", value: "BSA-made-up-key-0123456789xyz", expected: "BSA-****xyz" },
  ])("$name: '$value' -> '$expected'", ({ value, expected }) => {
    const actual = maskKey(value);

    expect(actual).toBe(expected);
  });
});
