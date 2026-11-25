/** A revealed personal field (RNX-357): the field and its value, null when the user has not set it. */
export type UserRevealView = {
  readonly field: string;
  readonly value: string | null;
};
