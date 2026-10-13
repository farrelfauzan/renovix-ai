import type { PolicyCheckResult } from "../service/memory-policy.service";

const IRRELEVANT_PATTERNS = [
  /^(hi|hello|hey|sup|yo|thanks|thank you|bye|goodbye|ok|okay)[\s!.?]*$/i,
  /^tell\s+me\s+a\s+joke/i,
  /^what(?:'s| is)\s+the\s+(?:weather|time|date)/i,
  /^(?:just\s+)?testing/i,
  /^how\s+are\s+you/i,
  /^what\s+can\s+you\s+do/i,
];

export function checkRelevance(content: string): PolicyCheckResult {
  const trimmed = content.trim();

  // Too short to be meaningful
  if (trimmed.length < 10) {
    return { allowed: false, reason: "Content too short to be meaningful" };
  }

  for (const pattern of IRRELEVANT_PATTERNS) {
    if (pattern.test(trimmed)) {
      return { allowed: false, reason: "Irrelevant/small talk content" };
    }
  }

  return { allowed: true };
}
