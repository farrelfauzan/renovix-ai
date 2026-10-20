import { BUILT_IN_ROLES } from "../config/built-in-roles";

const BUILT_IN_ROLE_NAMES: readonly string[] = Object.values(BUILT_IN_ROLES);

/** True for one of the five built-in roles, fixed in code (RNX-187): never renamed (D123), edited or deleted. */
export const isBuiltInRole = (name: string): boolean => BUILT_IN_ROLE_NAMES.includes(name);
