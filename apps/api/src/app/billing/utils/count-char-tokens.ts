/** Characters per token of the documented local count (docs/credits.md section 3.1 rule 1: characters ÷ 4). */
const CHARS_PER_TOKEN = 4;

/**
 * The token count CHARGED when the provider reported no usage (RX-22, D202-5, D205): ceil(characters / 4), counting
 * Unicode code points (not UTF-16 code units, so an emoji is one character).
 */
export function countCharTokens(text: string): number {
  return Math.ceil(Array.from(text).length / CHARS_PER_TOKEN);
}
