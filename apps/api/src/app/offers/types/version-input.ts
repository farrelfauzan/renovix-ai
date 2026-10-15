import type { ChangeAuthor } from "./change-author";

/** A new version of a package, pack or bundle: whose version, its terms, when it takes effect, and who makes it why. */
export type VersionInput<TTerms> = {
  /** The id of the package, pack or bundle. */
  readonly ownerId: string;
  readonly terms: TTerms;
  /** When the version takes effect; now when left out. */
  readonly effectiveFrom?: Date;
  readonly author: ChangeAuthor;
};
