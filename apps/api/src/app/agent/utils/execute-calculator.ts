import { evaluateCalculatorExpression } from "./evaluate-calculator-expression";

/**
 * Runs the `calculator` agent tool: the text the model reads back, never a throw.
 */
export function executeCalculator(args: { expression: string }): string {
  try {
    return `Result: ${evaluateCalculatorExpression(args.expression)}`;
  } catch (err: any) {
    return `Error evaluating expression: ${err.message}`;
  }
}
