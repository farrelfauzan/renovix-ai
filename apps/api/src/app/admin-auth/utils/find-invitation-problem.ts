/**
 * Why an invitation link cannot be completed at `now` (RX-95), or null when it can: used, revoked or
 * expired. A missing invitation is the caller's 404.
 */
export function findInvitationProblem(
  invitation: { readonly usedAt: Date | null; readonly revokedAt: Date | null; readonly expiresAt: Date },
  now: Date,
): string | null {
  if (invitation.usedAt) return "This invitation link has already been used";
  if (invitation.revokedAt) return "This invitation link has been revoked";
  if (invitation.expiresAt.getTime() <= now.getTime()) return "This invitation link has expired";
  return null;
}
