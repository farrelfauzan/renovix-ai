/**
 * Returns `value` if it is a same-site path (e.g. "/agents?x=1#y"), else "/".
 * Used for the login `redirect` param so it can never send the user off-site:
 * it must start with exactly one "/" (so no scheme and no "//host"), and must
 * not contain backslashes (browsers treat them as "/"), whitespace or control
 * characters (URL parsers drop tabs and newlines, so "/\t/host" would become
 * "//host"). Such a path always resolves on the current origin.
 */
export function safeRedirectPath(value: string | null | undefined): string {
  if (!value || !value.startsWith("/") || value.startsWith("//")) return "/";
  if (/[\\\s\x00-\x1f\x7f]/.test(value)) return "/";
  return value;
}
