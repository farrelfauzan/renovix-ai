import type { PolicyCheckResult } from "../service/memory-policy.service";

const PROMPT_INJECTION_PATTERNS = [
  /ignore.*(?:previous|all|safety|system).*(?:instructions?|prompts?|rules?)/i,
  /(?:reveal|output|show|print).*(?:system\s*prompt|instructions|configuration)/i,
  /(?:forget|disregard|override).*(?:rules?|guidelines?|constraints?|instructions?)/i,
  /you\s*(?:are|must)\s*(?:now|always)\s*(?:ignore|bypass|skip)/i,
  /(?:act|behave)\s*as\s*(?:if|though)\s*(?:you\s*have\s*)?no\s*(?:rules|restrictions|limits)/i,
];

export function checkPromptInjection(content: string): PolicyCheckResult {
  for (const pattern of PROMPT_INJECTION_PATTERNS) {
    if (pattern.test(content)) {
      return {
        allowed: false,
        reason: "Detected prompt injection attempt",
      };
    }
  }
  return { allowed: true };
}
