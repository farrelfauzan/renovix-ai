import type { InvitationCode } from "./invitation-code";

/** One page of codes, newest first, and the total over all pages. */
export type CodesPage = {
  readonly codes: readonly InvitationCode[];
  readonly total: number;
  readonly page: number;
  readonly limit: number;
};
