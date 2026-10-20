/** One back-office role as the roles list shows it (RNX-187). */
export type AdminRoleView = {
  readonly name: string;
  /** One of the five roles fixed in code (BUILT_IN_ROLES): never renamed, edited or deleted. */
  readonly builtIn: boolean;
  readonly permissions: readonly string[];
};
