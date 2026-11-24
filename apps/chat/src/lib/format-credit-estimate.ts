const CENTS_PER_CREDIT = 100;

/** A worst-case credit amount (the API's decimal string) for display: rounded up to two decimals, never down, so "up to" holds. */
export const formatCreditEstimate = (credits: string): string =>
  (Math.ceil(Number(credits) * CENTS_PER_CREDIT) / CENTS_PER_CREDIT).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
