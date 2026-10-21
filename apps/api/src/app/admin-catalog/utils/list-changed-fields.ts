import { hasSameValues } from "../../offers/utils/has-same-values";

/** The comma-separated names of the fields of `values` that differ from `before` (every field when there is no `before`). */
export function listChangedFields(before: object | null, values: object): string {
  return Object.entries(values)
    .filter(([key, value]) => !before || !hasSameValues(before, { [key]: value }))
    .map(([key]) => key)
    .join(",");
}
