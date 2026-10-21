import { Decimal } from "@prisma/client/runtime/client";
import type { TokenKindValues } from "../types/token-kind-values";

/** The token mix of the credit definition (docs/credits.md section 1.1, D115, D182). */
const NEW_INPUT_SHARE = new Decimal("0.36");
const CACHED_INPUT_SHARE = new Decimal("0.54");
const OUTPUT_SHARE = new Decimal("0.10");
const TOKENS_PER_MILLION = 1_000_000;

/**
 * The provider's dollar cost of one credit of a model at the token mix (RNX-185, docs/credits.md section 14.5):
 * the mix cost of 1,000,000 tokens (0.36 new input + 0.54 cached input + 0.10 output, prices in dollars per token)
 * divided by the tier's rates blended at the same mix (credits per 1,000,000 tokens). Exact decimal arithmetic.
 */
export function computeMixCostPerCredit({
  pricesPerToken,
  ratesPerMillionTokens,
}: {
  pricesPerToken: TokenKindValues;
  ratesPerMillionTokens: TokenKindValues;
}): Decimal {
  const blendAtMix = (values: TokenKindValues): Decimal =>
    values.newInput.mul(NEW_INPUT_SHARE).add(values.cachedInput.mul(CACHED_INPUT_SHARE)).add(values.output.mul(OUTPUT_SHARE));
  return blendAtMix(pricesPerToken).mul(TOKENS_PER_MILLION).div(blendAtMix(ratesPerMillionTokens));
}
