/**
 * Scans the serialized text of a generated OpenAPI document for things it must never contain
 * (RX-170): secret-ish names and key patterns, internal hostnames, and the values of any env var
 * given (the dummy test env of `test/setup-env.ts` and any other value to pin). Returns every
 * pattern that matched, with a short finding; an empty list means the document is clean.
 */
export type SecretPattern = { readonly label: string; readonly test: RegExp };

export function openApiSecretPatterns(envValues: readonly string[]): SecretPattern[] {
  const patterns: SecretPattern[] = [
    { label: "secret name", test: /SECRET/i },
    { label: "API key prefix", test: /rnx_live_|sk_live_|sk_test_|pk_live_|pk_test_/ },
    { label: "internal hostname", test: /\blocalhost\b|\b127\.0\.0\.1\b|\.internal\b/i },
    { label: "back-office test origin", test: /admin\.renovix\.test/ },
  ];
  for (const value of envValues) {
    const trimmed = value.trim();
    // Long enough to be a value worth flagging, not a substring that appears in every document.
    if (trimmed.length < 8) continue;
    patterns.push({ label: `env value "${trimmed.slice(0, 4)}…"`, test: new RegExp(escapeRegExp(trimmed)) });
  }
  return patterns;
}

/** Every pattern that matched the serialized document (empty: the document is clean). */
export function scanOpenApiDocumentForSecrets(document: unknown, envValues: readonly string[]): string[] {
  const serialized = JSON.stringify(document);
  return openApiSecretPatterns(envValues)
    .filter(({ test }) => test.test(serialized))
    .map(({ label }) => label);
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
