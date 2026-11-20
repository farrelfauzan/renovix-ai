export type NavigationItem = {
  readonly label: string;
  readonly href: string;
  /** Shown only to a role holding this permission (visibility only: the API decides); none: every admin. */
  readonly permission?: string;
};
