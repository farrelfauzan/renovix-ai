/** A model tier the user's packages do not allow, with the next listed package that grants it (RNX-76 B3, Q5). */
export type LockedTier = {
  readonly tier: string;
  readonly nextPackage: string | null;
};
