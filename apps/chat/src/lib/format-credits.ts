const CREDIT_FORMAT = new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 });

/** A credit amount (the API's decimal string) for display, with at most two decimals. */
export const formatCredits = (amount: string): string => CREDIT_FORMAT.format(Number(amount));
