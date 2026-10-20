/**
 * Staff permissions no custom role may hold (RNX-187, no escalation): with them a custom role could invite
 * admins or edit roles, including its own. Only the built-in Owner role holds them.
 */
export const OWNER_ONLY_PERMISSIONS: readonly string[] = ["admins:write", "roles:write"];
