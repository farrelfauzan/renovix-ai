/** How the screen shows and checks one setting; the API's schema stays the authority. */
export type SettingDescription = {
  readonly label: string;
  /**
   * Credit amounts may have six decimals and percentages are decimals too; counts are whole numbers. A boolean or
   * list setting is shown read-only: the screen edits numbers only (RNX-315).
   */
  readonly unit: "credits" | "percent" | "count" | "boolean" | "list";
  readonly min: number;
  /** True while nothing reads the stored value yet: the screen says so. */
  readonly isNotAppliedYet?: boolean;
};
