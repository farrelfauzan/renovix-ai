import { timingSafeEqual } from "node:crypto";
import { isSameOneTimeValue } from "./is-same-one-time-value";

jest.mock("node:crypto", () => {
  const actual = jest.requireActual<typeof import("node:crypto")>("node:crypto");
  return { ...actual, timingSafeEqual: jest.fn(actual.timingSafeEqual) };
});

const VALUE = "A".repeat(43);

describe("RX-152: isSameOneTimeValue (the browser's cookie against the state's one-time value)", () => {
  beforeEach(() => jest.mocked(timingSafeEqual).mockClear());

  it("control: the same value matches", () => {
    expect(isSameOneTimeValue(VALUE, VALUE)).toBe(true);
  });

  it.each([
    ["absent", undefined],
    ["empty", ""],
    ["one character different", `${"A".repeat(42)}B`],
    ["shorter", VALUE.slice(0, -1)],
    ["longer", `${VALUE}A`],
  ])("refuses a presented value that is %s", (_label, presented) => {
    expect(isSameOneTimeValue(presented, VALUE)).toBe(false);
  });

  it("compares equal-length values with crypto.timingSafeEqual", () => {
    isSameOneTimeValue(`${"A".repeat(42)}B`, VALUE);

    expect(timingSafeEqual).toHaveBeenCalledTimes(1);
  });
});
