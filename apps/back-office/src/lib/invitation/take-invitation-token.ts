/**
 * Reads the invitation token from the link's fragment (`/accept-invitation#token=…`, RX-95) and removes the
 * fragment from the address bar and the current history entry, so the token is kept in memory only: it is
 * not left in the history, a bookmark or a copied URL, and it is never written to any browser storage.
 */
export function takeInvitationToken(): string | null {
  const token = new URLSearchParams(window.location.hash.slice(1)).get("token");
  if (window.location.hash) window.history.replaceState(null, "", `${window.location.pathname}${window.location.search}`);
  return token || null;
}
