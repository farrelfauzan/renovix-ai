/** How the screen shows and checks one setting; the API's schema stays the authority. */
export type SettingDescription = {
  readonly label: string;
  /** Credit amounts may have six decimals and percentages are decimals too; everything else is a whole number. */
  readonly unit: "credits" | "percent" | "count";
  readonly min: number;
  /** True while nothing reads the stored value yet: the screen says so. */
  readonly isNotAppliedYet?: boolean;
};
