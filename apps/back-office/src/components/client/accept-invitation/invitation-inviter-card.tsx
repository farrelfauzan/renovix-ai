"use client";

import type { InvitationPreview } from "@/lib/invitation/invitation-preview";
import { InvitationCard } from "./invitation-card";

/** The sent date in the viewer's own time zone, e.g. "9 Oct 2026, 08:03 GMT+7". */
const SENT_AT_FORMAT: Intl.DateTimeFormatOptions = { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", timeZoneName: "short" };

/**
 * Who invited and to what (RNX-333), from the preview only: the inviter's name (their email when they have no
 * name), role name and the date the link was sent, then the invitee's email and role. The email is the invitation's:
 * the API takes it from there.
 */
export function InvitationInviterCard({ preview }: { preview: InvitationPreview }) {
  return (
    <InvitationCard>
      <div className="flex flex-col gap-1">
        <h1 className="text-xl font-bold tracking-[-0.01em]">You were invited by {preview.invitedBy.name ?? preview.invitedBy.email}</h1>
        <p className="text-[13px] text-rx-muted">
          <span className="capitalize">{preview.invitedBy.role}</span> · sent {new Date(preview.sentAt).toLocaleString("en-GB", SENT_AT_FORMAT)}
        </p>
      </div>
      <dl className="flex flex-col gap-2 text-[13px]">
        <div className="flex justify-between gap-2.5">
          <dt className="text-rx-muted">Your email</dt>
          <dd className="min-w-0 font-mono break-all">{preview.email}</dd>
        </div>
        <div className="flex justify-between gap-2.5">
          <dt className="text-rx-muted">Role</dt>
          <dd className="capitalize">{preview.role}</dd>
        </div>
      </dl>
      <p className="text-xs text-rx-muted">The email address cannot be changed here. Wrong address? Ask the person who invited you to send a new invitation.</p>
    </InvitationCard>
  );
}
