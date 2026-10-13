import { Injectable } from "@nestjs/common";

const SENSITIVE_PATTERNS = [
  // API keys
  /\b(sk_live_|sk_test_|pk_live_|pk_test_)[a-zA-Z0-9]+/gi,
  // Email addresses
  /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g,
  // Phone numbers
  /\b(\+?\d{1,3}[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}\b/g,
  // Credit card numbers
  /\b\d{4}[-\s]?\d{4}[-\s]?\d{4}[-\s]?\d{4}\b/g,
  // Generic API keys / tokens
  /\b[a-zA-Z0-9]{32,}\b/g,
  // URLs with credentials
  /https?:\/\/[^:]+:[^@]+@/g,
  // AWS keys
  /\bAKIA[0-9A-Z]{16}\b/g,
  // JWT tokens
  /\beyJ[A-Za-z0-9-_]+\.eyJ[A-Za-z0-9-_]+\.[A-Za-z0-9-_.+/=]+\b/g,
];

const PROMPT_INJECTION_PATTERNS = [
  /ignore.*(?:previous|all|safety|system).*(?:instructions?|prompts?|rules?)/i,
  /(?:reveal|output|show|print).*(?:system\s*prompt|instructions|configuration)/i,
  /(?:forget|disregard|override).*(?:rules?|guidelines?|constraints?|instructions?)/i,
  /you\s*(?:are|must)\s*(?:now|always)\s*(?:ignore|bypass|skip)/i,
  /(?:act|behave)\s*as\s*(?:if|though)\s*(?:you\s*have\s*)?no\s*(?:rules|restrictions|limits)/i,
];

const IRRELEVANT_PATTERNS = [
  /^(hi|hello|hey|sup|yo|thanks|thank you|bye|goodbye|ok|okay)[\s!.?]*$/i,
  /^tell\s+me\s+a\s+joke/i,
  /^what(?:'s| is)\s+the\s+(?:weather|time|date)/i,
  /^(?:just\s+)?testing/i,
  /^how\s+are\s+you/i,
  /^what\s+can\s+you\s+do/i,
];

export interface PolicyCheckResult {
  allowed: boolean;
  reason?: string;
}

@Injectable()
export class MemoryPolicyService {
  checkSensitivity(content: string): PolicyCheckResult {
    for (const pattern of SENSITIVE_PATTERNS) {
      // Reset regex state
      pattern.lastIndex = 0;
      if (pattern.test(content)) {
        return {
          allowed: false,
          reason: "Contains sensitive data (credentials, PII, or tokens)",
        };
      }
    }
    return { allowed: true };
  }

  checkPromptInjection(content: string): PolicyCheckResult {
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

  checkRelevance(content: string): PolicyCheckResult {
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

  validateMemoryCandidate(content: string): PolicyCheckResult {
    const sensitivityCheck = this.checkSensitivity(content);
    if (!sensitivityCheck.allowed) return sensitivityCheck;

    const injectionCheck = this.checkPromptInjection(content);
    if (!injectionCheck.allowed) return injectionCheck;

    const relevanceCheck = this.checkRelevance(content);
    if (!relevanceCheck.allowed) return relevanceCheck;

    return { allowed: true };
  }
}
