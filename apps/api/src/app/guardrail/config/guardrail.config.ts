/**
 * Guardrail configuration.
 * Auto-configured in the backend — no user-facing settings for MVP.
 *
 * Philosophy:
 * - Never ban or suspend users
 * - Allow profanity and angry language (normal human behavior)
 * - Only block truly dangerous/illegal content and prompt injection
 * - Return soft, polite decline messages as assistant responses
 * - Log violations for analytics only (future dashboard)
 */
export const GUARDRAIL_DEFAULTS = {
  maxResponseLength: 16000,
  enablePIIMasking: true,
  enableInjectionCheck: true,
  enableContentPolicy: true,
} as const;
