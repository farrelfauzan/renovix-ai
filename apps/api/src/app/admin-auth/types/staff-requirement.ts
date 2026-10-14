/** What a `staff` route asks of the session, from its `@Access` declaration. */
export type StaffRequirement = {
  /** Undefined: full sessions only. "enrolment": enrolment sessions only. "any": both. */
  readonly scope?: "enrolment" | "any";
  /** The session re-authenticated within the configured window. */
  readonly reauth: boolean;
};
