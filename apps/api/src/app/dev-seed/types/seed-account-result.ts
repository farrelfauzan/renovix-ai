/** What a dev seed run did: "granted" wrote the package and credits, "already-seeded" wrote nothing. */
export type SeedAccountResult = {
  readonly outcome: "granted" | "already-seeded";
  readonly userId: string;
  readonly code: string;
  readonly credits: number;
};
