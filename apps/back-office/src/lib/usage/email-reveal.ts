/** A revealed email, the answer of `POST /admin/usage/users/:userId/email`. */
export type EmailReveal = {
  readonly userId: string;
  readonly email: string;
};
