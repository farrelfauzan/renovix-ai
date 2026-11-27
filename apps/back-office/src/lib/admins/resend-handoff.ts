import type { IssuedInvitation } from "./issued-invitation";

let pending: IssuedInvitation | null = null;

/**
 * Carries the answer of a Resend from the page of the old invitation to the page of the new one (RNX-377). The route
 * has a different id after a resend, and Next.js remounts the page for another value of the same dynamic segment, so
 * the screen's own state (the link dialog, the status line) does not survive the move. The link lives here only
 * between `stash` and the first `clear` of the page that opens it: in module memory, never in the URL or in storage.
 */
export const resendHandoff = {
  stash: (issued: IssuedInvitation): void => {
    pending = issued;
  },
  /** The stashed answer when it is the one for the invitation with this id; it stays until `clear`. */
  peek: (id: string): IssuedInvitation | null => (pending?.invitation.id === id ? pending : null),
  clear: (): void => {
    pending = null;
  },
};
