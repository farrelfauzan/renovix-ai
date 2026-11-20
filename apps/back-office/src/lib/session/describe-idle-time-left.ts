const MS_PER_MINUTE = 60_000;

/**
 * The footer's idle line (RNX-312a, D353 Q4): the minutes left until `idleExpiresAt` of the last `/me` answer,
 * rounded. Approximate: other API calls move the real limit on without the footer knowing, and the clocks may differ.
 */
export function describeIdleTimeLeft(idleExpiresAt: string, now: number): string {
  const msLeft = Date.parse(idleExpiresAt) - now;
  if (msLeft < MS_PER_MINUTE) return "Session idle in under 1 min";
  return `Session idle in ${Math.round(msLeft / MS_PER_MINUTE)} min`;
}
