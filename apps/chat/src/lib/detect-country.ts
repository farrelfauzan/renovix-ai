import { COUNTRY_CODES } from "./country-codes";

/** The likely country of the browser's language ("id" and "id-ID" → "ID"), or "" when there is none. */
export function detectCountry(): string {
  try {
    const region = new Intl.Locale(navigator.language).maximize().region ?? "";
    return COUNTRY_CODES.includes(region) ? region : "";
  } catch {
    return "";
  }
}
