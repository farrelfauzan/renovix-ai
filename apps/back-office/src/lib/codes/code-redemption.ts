/** One redemption of a code: who (user id), when, and what it granted. */
export type CodeRedemption = {
  readonly id: string;
  readonly userId: string;
  readonly creditsGranted: string | null;
  readonly planGranted: string | null;
  readonly daysGranted: number | null;
  readonly redeemedAt: string;
};
