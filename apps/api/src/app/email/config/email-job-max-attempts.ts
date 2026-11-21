/**
 * How many times an email job is tried before it is "failed" (RNX-352: one constant for markFailed and the claim). Every
 * try counts: one that ends in an error (markFailed) and one whose claim lease ended before it was marked (the claim).
 */
export const EMAIL_JOB_MAX_ATTEMPTS = 3;
