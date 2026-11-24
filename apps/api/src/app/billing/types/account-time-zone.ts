/** RNX-329: a credit account and the timezone its usage days are counted in (an IANA name). */
export type AccountTimeZone = {
  readonly accountId: string;
  readonly timeZone: string;
};
