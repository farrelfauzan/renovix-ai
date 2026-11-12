"use client";

import { Button } from "@performa-ai/ui/components/button";
import { Input } from "@performa-ai/ui/components/input";
import type { IssuedInvitation } from "@/lib/admins/issued-invitation";

/**
 * Shows the single-use invitation link from a create or resend answer. The link lives only in the props of this
 * dialog (React memory): it is not written to any browser storage or URL, and closing the dialog drops it.
 */
export function InvitationLinkDialog({ issued, onClose }: { issued: IssuedInvitation; onClose: () => void }) {
  return (
    <section role="dialog" aria-label="Invitation created" className="mt-4 flex max-w-xl flex-col gap-2 rounded-rx border border-rx-line p-4">
      <p className="text-sm">
        Invitation for {issued.invitation.email} ({issued.invitation.role}). Copy the link now: it is shown only this time and cannot be shown again.
      </p>
      <Input readOnly aria-label="Invitation link" value={issued.link} onFocus={(event) => event.target.select()} className="rounded-rx border border-rx-line px-2 py-1 text-sm h-auto text-sm" />
      <Button variant="outline" type="button" onClick={onClose} className="self-start rounded-rx border border-rx-line px-3 py-1 text-sm h-auto bg-transparent font-normal whitespace-normal">Close</Button>
    </section>
  );
}
