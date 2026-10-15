/**
 * The origins the API accepts in production (CORS). `CORS_ORIGIN` (comma-separated) lists the product apps;
 * ADMIN_ORIGIN, the back-office app's own origin (RX-156, D141), is always added when the list is set, so
 * the back office can call the API. Without `CORS_ORIGIN` every origin is accepted, as before.
 */
export function resolveCorsOrigins(env: NodeJS.ProcessEnv): string[] | true {
  if (!env.CORS_ORIGIN) return true;
  const listed = env.CORS_ORIGIN.split(",").map((origin) => origin.trim()).filter(Boolean);
  const adminOrigin = env.ADMIN_ORIGIN?.trim();
  return adminOrigin && !listed.includes(adminOrigin) ? [...listed, adminOrigin] : listed;
}
