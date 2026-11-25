const MS_PER_MINUTE = 60_000;

/** The two limits on a session (ISO 8601) and the instant the time left is counted from (ms since epoch). */
type DescribeSessionTimeLeftInput = {
  readonly idleExpiresAt: string;
  readonly absoluteExpiresAt: string;
  readonly now: number;
};

/**
 * The footer's time line (RNX-312a, D353 Q4, RNX-346): the minutes left until whichever limit ends first, rounded.
 * "Session idle in" when the idle limit is sooner or equal, "Session ends in" when the absolute limit is sooner.
 * Approximate: other API calls move the idle limit on without the footer knowing, and the clocks may differ.
 */
export function describeSessionTimeLeft({ idleExpiresAt, absoluteExpiresAt, now }: DescribeSessionTimeLeftInput): string {
  const idleMsLeft = Date.parse(idleExpiresAt) - now;
  const absoluteMsLeft = Date.parse(absoluteExpiresAt) - now;
  const isAbsoluteSooner = absoluteMsLeft < idleMsLeft;
  const msLeft = Math.min(idleMsLeft, absoluteMsLeft);
  const label = isAbsoluteSooner ? "Session ends in" : "Session idle in";
  if (msLeft < MS_PER_MINUTE) return `${label} under 1 min`;
  return `${label} ${Math.round(msLeft / MS_PER_MINUTE)} min`;
}
