import { hasConflict } from "./has-conflict";

describe("RX-131: hasConflict (more than half of the shorter memory's words also in the other)", () => {
  it.each([
    { name: "2 of 3 words shared", existing: "User likes coffee", incoming: "user likes tea", expected: true },
    { name: "1 of 3 words shared", existing: "Works in finance", incoming: "Lives in Jakarta", expected: false },
    { name: "the same text", existing: "prefers short answers", incoming: "prefers short answers", expected: true },
    { name: "exactly half is not enough", existing: "a b", incoming: "a c", expected: false },
    { name: "case does not matter", existing: "coffee", incoming: "Coffee", expected: true },
    { name: "measured against the shorter one", existing: "likes coffee a lot", incoming: "coffee", expected: true },
    { name: "punctuation makes another word", existing: "likes coffee.", incoming: "likes coffee", expected: false },
    { name: "empty against text", existing: "", incoming: "anything", expected: false },
    { name: "empty against empty", existing: "", incoming: "", expected: true },
  ])("$name: '$existing' / '$incoming' -> $expected", ({ existing, incoming, expected }) => {
    const actual = hasConflict(existing, incoming);

    expect(actual).toBe(expected);
  });
});
