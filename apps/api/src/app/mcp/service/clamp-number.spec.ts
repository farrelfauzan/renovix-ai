import { WebSearchService } from "./web-search.service";

describe("RX-131: clampNumber (a whole number between min and max, or the fallback)", () => {
  it.each([
    { name: "inside the range", value: 5, min: 1, max: 10, fallback: 3, expected: 5 },
    { name: "below min", value: 0, min: 1, max: 10, fallback: 3, expected: 1 },
    { name: "above max", value: 11, min: 1, max: 10, fallback: 3, expected: 10 },
    { name: "a number as text", value: "7", min: 1, max: 10, fallback: 3, expected: 7 },
    { name: "rounded down", value: 7.9, min: 1, max: 10, fallback: 3, expected: 7 },
    { name: "rounded down below zero", value: -0.5, min: -5, max: 5, fallback: 0, expected: -1 },
    { name: "not a number", value: "abc", min: 1, max: 10, fallback: 3, expected: 3 },
    { name: "undefined", value: undefined, min: 1, max: 10, fallback: 3, expected: 3 },
    { name: "Infinity", value: Infinity, min: 1, max: 10, fallback: 3, expected: 3 },
    { name: "null is 0", value: null, min: 1, max: 10, fallback: 3, expected: 1 },
    { name: "empty text is 0", value: "", min: 1, max: 10, fallback: 3, expected: 1 },
    { name: "true is 1", value: true, min: 1, max: 10, fallback: 3, expected: 1 },
  ])("$name: $value in [$min, $max] -> $expected", ({ value, min, max, fallback, expected }) => {
    const actual = WebSearchService.prototype["clampNumber"](value, min, max, fallback);

    expect(actual).toBe(expected);
  });
});
