/** Who makes a catalog or settings change, and why: written onto its change record. */
export type ChangeAuthor = {
  /** An admin id, or an operator label such as "seed:<name>" (the seed script has no admin). */
  readonly changedBy: string;
  readonly reason: string;
};
