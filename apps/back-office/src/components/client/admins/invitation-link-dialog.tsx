"use client";

import type { IssuedInvitation } from "@/lib/admins/issued-invitation";

/**
 * Shows the single-use invitation link from a create or resend answer. The link lives only in the props of this
 * dialog (React memory): it is not written to any browser storage or URL, and closing the dialog drops it.
 */
export function InvitationLinkDialog({ issued, onClose }: { issued: IssuedInvitation; onClose: () => void }) {
  return (
    <section role="dialog" aria-label="Invitation created" className="mt-4 flex max-w-xl flex-col gap-2 rounded border border-neutral-300 p-4">
      <p className="text-sm">
        Invitation for {issued.invitation.email} ({issued.invitation.role}). Copy the link now: it is shown only this time and cannot be shown again.
      </p>
      <input readOnly aria-label="Invitation link" value={issued.link} onFocus={(event) => event.target.select()} className="rounded border border-neutral-300 px-2 py-1 text-sm" />
      <button type="button" onClick={onClose} className="self-start rounded border border-neutral-300 px-3 py-1 text-sm">Close</button>
    </section>
  );
}
