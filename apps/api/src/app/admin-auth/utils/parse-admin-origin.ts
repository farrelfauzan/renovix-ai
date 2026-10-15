/**
 * The back-office origin from ADMIN_ORIGIN (RX-156, D117 item 73). No fallback in any environment: throws
 * when it is unset or empty, and when it is not exactly one origin (scheme, host, optional port; no path,
 * no trailing slash), so the API does not start instead of refusing or allowing every /admin request.
 */
export function parseAdminOrigin(raw: string | undefined): string {
  if (raw === undefined || raw === "") {
    throw new Error("ADMIN_ORIGIN is required: the back-office origin, e.g. https://admin.renovix.id");
  }
  if (!URL.canParse(raw) || new URL(raw).origin !== raw) {
    throw new Error(`ADMIN_ORIGIN must be an origin such as https://admin.renovix.id (no path, no trailing slash), got "${raw}"`);
  }
  return raw;
}
