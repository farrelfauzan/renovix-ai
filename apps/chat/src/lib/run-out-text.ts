import type { CreditMeterProjection } from "@/hooks/use-credit-meter";

/** The sidebar's run-out line (D45); the date label comes from the API, already in the profile timezone. */
export function runOutText(projection: CreditMeterProjection): string {
  if (projection.status === "date") return `At this rate your credits run out on ${projection.runOutLabel}`;
  if (projection.status === "not_enough_use") return "Not enough use yet to estimate";
  return "More than a year at your current pace";
}
