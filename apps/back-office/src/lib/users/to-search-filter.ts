/**
 * The exact lookup a search text asks for: an email when it holds "@", a user id otherwise, nothing when blank. The
 * text is trimmed; the API compares for equality (no prefix or partial match).
 */
export function toSearchFilter(text: string): { readonly email?: string; readonly id?: string } {
  const value = text.trim();
  if (!value) return {};
  return value.includes("@") ? { email: value } : { id: value };
}
