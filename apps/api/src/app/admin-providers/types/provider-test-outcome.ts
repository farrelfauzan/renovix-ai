/** The answer of POST /admin/providers/:id/test (RX-177) when it answers 200 (passed or failed); a failure carries a fixed-text reason, which is stored. 400/404/409 are thrown. */
export type ProviderTestOutcome = {
  readonly isSuccessful: boolean;
  readonly reason: string | null;
  readonly testedAt: Date;
};
