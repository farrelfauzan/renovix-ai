import { timingSafeEqual } from "node:crypto";

/**
 * True when the value the browser presented (its MCP OAuth cookie) equals the flow's one-time value
 * (RX-152). Constant-time compare on equal-length buffers; an absent value or a different length is
 * false.
 */
export function isSameOneTimeValue(presented: string | undefined, expected: string): boolean {
  if (presented === undefined) return false;
  const actual = Buffer.from(presented);
  const wanted = Buffer.from(expected);
  return actual.length === wanted.length && timingSafeEqual(actual, wanted);
}
