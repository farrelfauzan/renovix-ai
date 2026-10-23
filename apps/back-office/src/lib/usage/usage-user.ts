/** A user in a usage row: the id, and the email masked ("***") by the API. */
export type UsageUser = {
  readonly id: string;
  readonly email: unknown;
};
