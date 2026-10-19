/**
 * The token count used for the HOLD ESTIMATE only (RX-22, D205): the UTF-8 byte length. Every token of a byte-level
 * tokenizer covers at least one byte, so the estimate never counts fewer tokens than a provider does; it counts more
 * (about four times for English text). A charge without a usage report uses `countCharTokens`.
 */
export function countTextTokens(text: string): number {
  return Buffer.byteLength(text, "utf8");
}
