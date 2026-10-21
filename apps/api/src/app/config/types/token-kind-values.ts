import type { Decimal } from "@prisma/client/runtime/client";

/** One value per token kind (docs/credits.md section 1.1): a model's prices or a tier's rates. */
export interface TokenKindValues {
  readonly newInput: Decimal;
  readonly cachedInput: Decimal;
  readonly output: Decimal;
}
