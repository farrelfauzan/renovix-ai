/** An error's class name only, for a log line (RNX-35): a provider error's message could carry a key or account detail. */
export const errorNameOf = (err: unknown): string => (err instanceof Error ? err.name : typeof err);
