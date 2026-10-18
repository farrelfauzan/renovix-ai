type Token =
  | { readonly type: "number"; readonly value: number }
  | { readonly type: "symbol"; readonly symbol: string };

type BinaryOperator = "+" | "-" | "*" | "/" | "%" | "^";

const SYMBOL_CHARACTERS = "+-*/%^()";
const WHITESPACE_PATTERN = /^[ \t\r\n]$/;
const NUMBER_CHARACTER_PATTERN = /^[0-9.]$/;
const NUMBER_RUN_PATTERN = /^[0-9.]+/;
// digits with at most one decimal point: 1, 2.5, 5., .5
const NUMBER_LITERAL_PATTERN = /^(\d+\.?\d*|\.\d+)$/;
const INVALID_RESULT_MESSAGE = "Expression did not evaluate to a valid number";

function assertFinite(value: number): number {
  if (!Number.isFinite(value)) {
    throw new Error(INVALID_RESULT_MESSAGE);
  }
  return value;
}

function parseNumberLiteral(literal: string): number {
  if (!NUMBER_LITERAL_PATTERN.test(literal)) {
    throw new Error(`Invalid number "${literal}"`);
  }
  return assertFinite(Number(literal));
}

function readNumberLiteral(expression: string, startIndex: number): string {
  const match = NUMBER_RUN_PATTERN.exec(expression.slice(startIndex));
  return match ? match[0] : "";
}

function tokenize(expression: string): Token[] {
  const tokens: Token[] = [];
  let index = 0;
  while (index < expression.length) {
    const character = expression[index];
    if (WHITESPACE_PATTERN.test(character)) {
      index += 1;
    } else if (SYMBOL_CHARACTERS.includes(character)) {
      tokens.push({ type: "symbol", symbol: character });
      index += 1;
    } else if (NUMBER_CHARACTER_PATTERN.test(character)) {
      const literal = readNumberLiteral(expression, index);
      tokens.push({ type: "number", value: parseNumberLiteral(literal) });
      index += literal.length;
    } else {
      throw new Error(
        `Invalid character ${JSON.stringify(character)} in expression`,
      );
    }
  }
  return tokens;
}

function applyOperator(
  operator: BinaryOperator,
  left: number,
  right: number,
): number {
  switch (operator) {
    case "+":
      return assertFinite(left + right);
    case "-":
      return assertFinite(left - right);
    case "*":
      return assertFinite(left * right);
    case "/":
      return assertFinite(left / right);
    case "%":
      return assertFinite(left % right);
    case "^":
      return assertFinite(left ** right);
  }
}

/**
 * Recursive-descent parser. Grammar (lowest to highest precedence):
 *   expression := term (("+" | "-") term)*
 *   term       := unary (("*" | "/" | "%") unary)*
 *   unary      := "-" unary | power
 *   power      := primary ("^" unary)?        right-associative, so -2^2 is -4
 *   primary    := number | "(" expression ")"
 */
class ExpressionParser {
  private position = 0;

  constructor(private readonly tokens: readonly Token[]) {}

  parse(): number {
    const value = this.parseExpression();
    if (this.position < this.tokens.length) {
      throw new Error(`Unexpected token at position ${this.position + 1}`);
    }
    return value;
  }

  private peekSymbol(): string | undefined {
    const token = this.tokens[this.position];
    return token?.type === "symbol" ? token.symbol : undefined;
  }

  private parseExpression(): number {
    let left = this.parseTerm();
    let symbol = this.peekSymbol();
    while (symbol === "+" || symbol === "-") {
      this.position += 1;
      left = applyOperator(symbol, left, this.parseTerm());
      symbol = this.peekSymbol();
    }
    return left;
  }

  private parseTerm(): number {
    let left = this.parseUnary();
    let symbol = this.peekSymbol();
    while (symbol === "*" || symbol === "/" || symbol === "%") {
      this.position += 1;
      left = applyOperator(symbol, left, this.parseUnary());
      symbol = this.peekSymbol();
    }
    return left;
  }

  private parseUnary(): number {
    if (this.peekSymbol() === "-") {
      this.position += 1;
      return -this.parseUnary();
    }
    return this.parsePower();
  }

  private parsePower(): number {
    const base = this.parsePrimary();
    if (this.peekSymbol() !== "^") {
      return base;
    }
    this.position += 1;
    return applyOperator("^", base, this.parseUnary());
  }

  private parsePrimary(): number {
    const token = this.tokens[this.position];
    if (!token) {
      throw new Error("Unexpected end of expression");
    }
    if (token.type === "number") {
      this.position += 1;
      return token.value;
    }
    if (token.symbol !== "(") {
      throw new Error(`Unexpected token at position ${this.position + 1}`);
    }
    this.position += 1;
    const value = this.parseExpression();
    if (this.peekSymbol() !== ")") {
      throw new Error("Missing closing parenthesis");
    }
    this.position += 1;
    return value;
  }
}

/**
 * Evaluates an arithmetic expression without eval or Function.
 * Allowed: decimal numbers, `+ - * / %`, `^` (right-associative power),
 * parentheses, unary minus and whitespace. Anything else throws, as does a
 * non-finite or NaN result (also for any intermediate step).
 */
export function evaluateCalculatorExpression(expression: string): number {
  if (typeof expression !== "string") {
    throw new Error("Expression must be a string");
  }
  const tokens = tokenize(expression);
  if (tokens.length === 0) {
    throw new Error("Expression is empty");
  }
  return assertFinite(new ExpressionParser(tokens).parse());
}
