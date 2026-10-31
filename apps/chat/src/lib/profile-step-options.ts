/** RNX-33: the choices of the profile step (design artboard "Profile"). */
export const ROLE_OPTIONS = [
  "Finance",
  "Operations",
  "Sales",
  "Customer support",
  "Owner or director",
  "IT or engineering",
  "Other",
] as const;

/** The languages the API accepts (`en`, `id`), stored as the user's locale. */
export const LANGUAGE_OPTIONS = [
  { value: "id", label: "Bahasa Indonesia" },
  { value: "en", label: "English" },
] as const;

/** What the user wants to do; the picked ones are saved joined with ", ". */
export const GOAL_OPTIONS = [
  "Reports and documents",
  "Data analysis",
  "Customer support",
  "Internal knowledge search",
  "Automation and reminders",
] as const;
