/** One role of `GET /admin/roles` (RNX-187). */
export type AdminRole = {
  readonly name: string;
  readonly permissions: readonly string[];
  readonly builtIn: boolean;
};
