/** True when `held` contains every permission in `required` (a route's permissions are all required). */
export const hasAllPermissions = (held: readonly string[], required: readonly string[]): boolean =>
  required.every((permission) => held.includes(permission));
