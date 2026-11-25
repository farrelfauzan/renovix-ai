const MS_PER_MINUTE = 60_000;
const MINUTES_PER_HOUR = 60;

/**
 * The header line of the invitation's password step (RNX-333): the link is single use, and the time left until the
 * preview's `expiresAt`, in whole hours and minutes. Counted on this browser's clock, so approximate.
 */
export function describeLinkExpiry(expiresAt: string, now: number): string {
  const minutesLeft = Math.floor((Date.parse(expiresAt) - now) / MS_PER_MINUTE);
  if (minutesLeft < 1) return "Invitation link, single use, expires in under 1 min";
  return `Invitation link, single use, expires in ${Math.floor(minutesLeft / MINUTES_PER_HOUR)} h ${minutesLeft % MINUTES_PER_HOUR} min`;
}
