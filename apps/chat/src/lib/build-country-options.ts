import { COUNTRY_CODES } from "@/lib/country-codes";

/** The countries offered first (the design's list); the rest follow by name. */
const FIRST_COUNTRIES = ["ID", "SG", "MY"];

/** The profile step's country choices: Indonesia, Singapore and Malaysia first, then every other country by name. */
export function buildCountryOptions(): { value: string; label: string }[] {
  const names = new Intl.DisplayNames(["en"], { type: "region" });
  const toOption = (code: string): { value: string; label: string } => ({ value: code, label: names.of(code) ?? code });
  const rest = COUNTRY_CODES.filter((code) => !FIRST_COUNTRIES.includes(code)).map(toOption);
  return [...FIRST_COUNTRIES.map(toOption), ...rest.sort((a, b) => a.label.localeCompare(b.label))];
}
