const MAX_INITIALS = 2;

/** Up to two capital initials for the footer avatar (RNX-312a): of the name's words, else of the email's first letter. */
export function initialsOf(name: string | null, email: string): string {
  const words = (name ?? "").split(/\s+/).filter(Boolean);
  const letters = words.length > 0 ? words.slice(0, MAX_INITIALS).map((word) => word[0]) : [email[0]];
  return letters.join("").toUpperCase();
}
