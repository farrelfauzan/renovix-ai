/** The terms of a new version as the API's body takes them (which keys depends on the kind), with why and when. */
export type VersionInput = {
  readonly terms: Readonly<Record<string, number | boolean | string | readonly string[] | null>>;
  readonly reason: string;
  /** ISO 8601 date-time with its offset. */
  readonly effectiveFrom: string;
};
