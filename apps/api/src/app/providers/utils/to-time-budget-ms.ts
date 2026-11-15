/** RNX-44: milliseconds per second of the `modelCallBudgetSeconds` platform setting. */
const MS_PER_SECOND = 1000;

/** RNX-44: the `modelCallBudgetSeconds` setting as a call's `timeBudgetMs`; undefined (no budget) when it is not set. */
export const toTimeBudgetMs = (seconds: number | null): number | undefined => (seconds ? seconds * MS_PER_SECOND : undefined);
