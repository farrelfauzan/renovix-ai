/** The answer of POST /admin/providers/:id/test (RX-177): always 200; a failure carries a readable reason, which is stored. */
export type ProviderTestOutcome = {
  readonly isSuccessful: boolean;
  readonly reason: string | null;
  readonly testedAt: Date;
};
