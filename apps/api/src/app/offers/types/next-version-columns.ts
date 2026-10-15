/** The columns every new version row gets besides its terms. effectiveFrom left out means the time of the insert. */
export type NextVersionColumns = {
  readonly versionNumber: number;
  readonly createdBy: string;
  readonly reason: string;
  readonly effectiveFrom?: Date;
};
