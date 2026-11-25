import type { PiiField } from "./pii-field";

/** The body of `POST /admin/users/:id/reveal`: the field and why it is revealed (1 to 500 characters). */
export type UserRevealInput = {
  readonly field: PiiField;
  readonly reason: string;
};
