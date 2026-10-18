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

    // QA's failed-test repro (RX-55): a long digit run followed by ".." used to make the
    // number-literal regex backtrack quadratically — 65000 digits took ~3s and blocked
    // the event loop. The literal pattern is now linear; this pins a time bound on it
    // so a reintroduced nested-quantifier shape fails the suite (D83).
    it("rejects a 65000-digit run followed by '..' quickly (linear, no event-loop block)", () => {
      const hostile = "1".repeat(65_000) + "..";
      const startedAt = Date.now();
      expect(() => evaluateCalculatorExpression(hostile)).toThrow("Invalid number");
      expect(Date.now() - startedAt).toBeLessThan(500);
    });
  });

  describe("the number-literal pattern is linear (red control for the quadratic regex)", () => {
    // The OLD pattern (\d+\.?\d*|\.\d+) is the same language but backtracks quadratically.
    // This control runs it directly and pins that it would exceed the bound, proving the
    // time-bound test above is a real guard, not a tautology (D83: red with the fault planted).
    it("the old quadratic shape takes seconds on the same input (the fault this fix removes)", () => {
      const oldPattern = /^(\d+\.?\d*|\.\d+)$/;
      const hostile = "1".repeat(65_000) + "..";
      const startedAt = Date.now();
      oldPattern.test(hostile);
      const elapsed = Date.now() - startedAt;
      expect(elapsed).toBeGreaterThan(1_000); // the planted fault: >1s for 65k chars
    });
  });
});
