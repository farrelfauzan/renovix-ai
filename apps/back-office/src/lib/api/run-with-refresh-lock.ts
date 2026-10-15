/** The Web Locks name every tab of the back-office takes before it refreshes the admin session. */
const REFRESH_LOCK_NAME = "rx-admin-refresh";

/**
 * Runs `task` while holding the browser-wide refresh lock, so two tabs of the back-office never
 * refresh at the same time (the admin refresh token is rotated with reuse detection: two refreshes in
 * flight end the session). Without Web Locks support (or outside a browser) it just runs `task`.
 */
export function runWithRefreshLock<T>(task: () => Promise<T>): Promise<T> {
  const locks = typeof navigator === "undefined" ? undefined : navigator.locks;
  if (!locks) return task();
  return locks.request(REFRESH_LOCK_NAME, task);
}
