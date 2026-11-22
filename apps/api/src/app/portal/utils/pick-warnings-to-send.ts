import type { CreditWarningLevel } from "@generated/prisma/client.js";
import type { WarningsToSendInput } from "../types/warnings-to-send-input";

/**
 * RNX-329: the warnings to queue for an account now: its current level (amber or red) and floor, when the floor flag is
 * set, less those already queued in its purchase cycle. A level that is skipped (straight to red) is not sent, and amber
 * is not sent once red has been in the cycle.
 */
export function pickWarningsToSend(input: WarningsToSendInput): CreditWarningLevel[] {
  const { level, recorded } = input;
  const reached: CreditWarningLevel[] = [];
  if (level === "red") reached.push("red");
  if (level === "amber" && !recorded.includes("red")) reached.push("amber");
  if (input.belowFloor) reached.push("floor");
  return reached.filter((candidate) => !recorded.includes(candidate));
}
