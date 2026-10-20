/** The body of a role create or update: the name and the permissions the role holds. */
export type RoleInput = {
  readonly name: string;
  readonly permissions: readonly string[];
};
