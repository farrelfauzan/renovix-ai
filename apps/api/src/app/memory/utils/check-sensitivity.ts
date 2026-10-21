import type { PolicyCheckResult } from "../service/memory-policy.service";

const SENSITIVE_PATTERNS = [
  // API keys (RNX-18: ours are rnx_live_)
  /\b(rnx_live_|sk_live_|sk_test_|pk_live_|pk_test_)[a-zA-Z0-9]+/gi,
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

export function checkSensitivity(content: string): PolicyCheckResult {
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
