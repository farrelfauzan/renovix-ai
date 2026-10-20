/**
 * The invitation link of the back office (RX-95): the token travels in the fragment, which browsers do not
 * send to a server, so it stays out of the back-office's request logs; the page posts it to the API in a body.
 */
export function buildInvitationLink(adminOrigin: string, token: string): string {
  return `${adminOrigin}/accept-invitation#token=${token}`;
}
