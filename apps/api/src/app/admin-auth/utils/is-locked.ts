/** True while an admin's lock lasts: `lockedUntil` is set and later than `now`. */
export function isLocked(lockedUntil: Date | null, now: Date): boolean {
  return lockedUntil !== null && lockedUntil.getTime() > now.getTime();
}
