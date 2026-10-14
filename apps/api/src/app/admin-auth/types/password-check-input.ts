/** Input of `findPasswordProblem`. */
export type PasswordCheckInput = {
  readonly password: string;
  readonly email: string;
  readonly minLength: number;
  /** Lowercased breached passwords. */
  readonly breached: ReadonlySet<string>;
};
