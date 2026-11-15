/**
 * RNX-30-A (D45, D352 Q3): the fixed parts of the run-out projection. These are the rule's definition, not thresholds:
 * every threshold (amber, red, floor, minimum spend, longest run-out, per-run cap) is a platform setting.
 */
export const RUN_OUT_PROJECTION = {
  /** The rate is the paid credits spent in this many days, divided by it (D45, D47: the 7-day average). */
  windowDays: 7,
  /** Fewer distinct days with paid usage in the window, counted in the profile timezone, is "not enough use" (D352 Q3). */
  minUsageDays: 3,
  /** The profile timezone of a user without one (User.timezone's default). */
  defaultTimeZone: "UTC",
} as const;
