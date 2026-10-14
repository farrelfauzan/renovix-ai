import { readPositiveInteger } from "./read-positive-integer";

describe("readPositiveInteger (RX-160)", () => {
  it.each([undefined, ""])("unset (%j) → the fallback", (value) => {
    expect(readPositiveInteger({ name: "X", value, fallback: 4096 })).toBe(4096);
  });

  it("a positive integer is used", () => {
    expect(readPositiveInteger({ name: "X", value: "16000", fallback: 4096 })).toBe(16000);
  });

  it.each(["0", "-5", "1.5", "lots", " "])("refuses %j, naming the variable", (value) => {
    expect(() => readPositiveInteger({ name: "LLM_DEFAULT_MAX_TOKENS", value, fallback: 4096 })).toThrow(
      `LLM_DEFAULT_MAX_TOKENS must be a positive integer (got "${value}")`,
    );
  });
});
