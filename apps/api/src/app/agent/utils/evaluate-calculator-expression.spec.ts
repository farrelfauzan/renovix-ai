import { evaluateCalculatorExpression } from "./evaluate-calculator-expression";

describe("RX-55: evaluateCalculatorExpression", () => {
  describe("accepted expressions", () => {
    it.each<[string, number]>([
      ["1+1", 2],
      ["2*3+4", 10],
      ["2+3*4", 14],
      ["(1+2)*3", 9],
      ["2^3^2", 512],
      ["2^10", 1024],
      ["-3+5", 2],
      ["2*-3", -6],
      ["-(1+2)", -3],
      ["10%3", 1],
      ["7/2", 3.5],
      [" 1 + 1 ", 2],
      ["0.1+0.2", 0.30000000000000004],
      ["2.5*2", 5],
      ["10-4-3", 3],
      ["100/10/5", 2],
      ["2^-1", 0.5],
      ["-2^2", -4],
      ["--3", 3],
      ["((2))", 2],
      ["1\t+\n1", 2],
      ["999999999999*999999999999", 999999999998000000000000],
      ["10^300", 1e300],
    ])("evaluates %j to %p", (inputExpression, expectedValue) => {
      const actualValue = evaluateCalculatorExpression(inputExpression);

      expect(actualValue).toBe(expectedValue);
    });
  });

  describe("rejected expressions", () => {
    it.each([
      [""],
      ["   "],
      ["abc"],
      ["1+a"],
      ["Math.pow(2,3)"],
      ["1..2"],
      ["1.2.3"],
      ["**"],
      ["2**3"],
      ["1+*2"],
      ["1+"],
      ["+"],
      ["*2"],
      ["1 2"],
      ["(1+2"],
      ["1+2)"],
      ["()"],
      ["(()"],
      ["1,2"],
      ["0x10"],
      ["1e3"],
      ["Infinity"],
      ["NaN"],
      ["constructor"],
      ["1;2"],
      ['"1"+1'],
      ["'"],
      ["`1`"],
      ["constructor.constructor('return 1')()"],
      ["1/0"],
      ["-1/0"],
      ["0/0"],
      ["5%0"],
      ["2^1024"],
      ["2^1024^2"],
      ["10^308*10"],
      ["1" + "0".repeat(400)],
    ])("throws for %j", (inputExpression) => {
      expect(() => evaluateCalculatorExpression(inputExpression)).toThrow(
        Error,
      );
    });

    it("uses the existing message for a non-finite result", () => {
      expect(() => evaluateCalculatorExpression("1/0")).toThrow(
        "Expression did not evaluate to a valid number",
      );
      expect(() => evaluateCalculatorExpression("0/0")).toThrow(
        "Expression did not evaluate to a valid number",
      );
    });

    it("throws for a non-string input", () => {
      expect(() =>
        evaluateCalculatorExpression(undefined as unknown as string),
      ).toThrow("Expression must be a string");
      expect(() =>
        evaluateCalculatorExpression({} as unknown as string),
      ).toThrow("Expression must be a string");
    });
  });
});
