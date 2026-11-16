/**
 * RNX-30-A (D45): the paid wallet's projected run-out. `date`: the instant and its label "DD/MM/YYYY HH:00" in the
 * profile timezone; `not_enough_use`: "Not enough use yet to estimate"; `more_than_a_year`: "More than a year at your
 * current pace".
 */
export type RunOutProjection =
  | { readonly status: "date"; readonly runOutAt: Date; readonly runOutLabel: string; readonly timeZone: string }
  | { readonly status: "not_enough_use" }
  | { readonly status: "more_than_a_year" };
