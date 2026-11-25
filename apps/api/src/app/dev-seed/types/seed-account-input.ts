/** What to seed: the existing account's email and the credits to grant (the seed file's default when left out). */
export type SeedAccountInput = {
  readonly email: string;
  readonly credits?: number;
};
