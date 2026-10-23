/** A change of an offer's own fields (no new version), with the required reason. Only the changed fields are sent. */
export type FlagsInput = {
  readonly active?: boolean;
  readonly visible?: boolean;
  readonly displayOrder?: number;
  readonly reason: string;
};
