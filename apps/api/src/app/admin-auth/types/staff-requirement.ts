/** What a `staff` route asks of the session, from its `@Access` declaration. */
export type StaffRequirement = {
  /** Undefined: full sessions only. "enrolment": enrolment sessions only. "any": both. */
  readonly scope?: "enrolment" | "any";
  /** The session re-authenticated within the configured window. */
  readonly reauth: boolean;
  /** Staff permissions the admin's role must all hold (RX-96); empty: none. */
  readonly permissions: readonly string[];
};
