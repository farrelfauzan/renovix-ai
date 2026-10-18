import { executeCalculator } from "./execute-calculator";

describe("RX-55: executeCalculator (the calculator agent tool)", () => {
  it("returns the result text", () => {
    expect(executeCalculator({ expression: "2+3*4" })).toBe("Result: 14");
  });

  it("returns an error text for a rejected expression", () => {
    expect(executeCalculator({ expression: "Math.pow(2,3)" })).toMatch(
      /^Error evaluating expression: /,
    );
  });

  it("returns the non-finite message for a division by zero", () => {
    expect(executeCalculator({ expression: "1/0" })).toBe(
      "Error evaluating expression: Expression did not evaluate to a valid number",
    );
  });
});
