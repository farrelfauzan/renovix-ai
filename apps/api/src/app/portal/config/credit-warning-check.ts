/** RNX-329: the hourly run-out warning check reads the paid accounts this many at a time (keyset pages by account id). */
export const CREDIT_WARNING_CHECK = {
  pageSize: 100,
} as const;
