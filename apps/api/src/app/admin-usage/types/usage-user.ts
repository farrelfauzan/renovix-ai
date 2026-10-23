/** A user in a report row (RNX-228): the id, and the email masked ("***"); revealing it needs users:read_pii. */
export type UsageUser = {
  readonly id: string;
  readonly email: unknown;
};
