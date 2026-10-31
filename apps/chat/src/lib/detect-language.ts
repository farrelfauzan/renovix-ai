/** The profile step's default language: "id" for an Indonesian browser, else "en". */
export function detectLanguage(): "id" | "en" {
  return navigator.language.toLowerCase().startsWith("id") ? "id" : "en";
}
