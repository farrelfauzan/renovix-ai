/** RNX-179: consecutive failed calls of one provider record that open its breaker. */
const FAILURES_TO_OPEN = 5;
/** RNX-179: how long an open breaker skips the provider record. */
const OPEN_MS = 30_000;

/**
 * RNX-179: one circuit breaker per provider record (ported from the HMS pattern). A provider record whose calls
 * failed FAILURES_TO_OPEN times in a row is skipped for OPEN_MS. After that the next call is tried: a success closes
 * the breaker (the count starts again), a failure opens it again at once. Only that provider's own failures count, so
 * a dead gateway never trips another provider. The state is in this process's memory: each Cloud Run instance keeps
 * its own breakers, which is accepted (an instance that has not seen the failures tries the provider itself).
 */
export class ProviderCircuitBreaker {
  private readonly failures = new Map<string, number>();
  private readonly openUntil = new Map<string, number>();

  /** @param now the clock, injectable for tests. */
  constructor(private readonly now: () => number = () => Date.now()) {}

  /** Whether calls to this provider record are skipped now. */
  isOpen(providerRecordId: string): boolean {
    return this.now() < (this.openUntil.get(providerRecordId) ?? 0);
  }

  /** A call to the provider record succeeded: the breaker closes. */
  recordSuccess(providerRecordId: string): void {
    this.failures.delete(providerRecordId);
    this.openUntil.delete(providerRecordId);
  }

  /** A call to the provider record failed; returns whether the breaker is now open. */
  recordFailure(providerRecordId: string): boolean {
    const failures = (this.failures.get(providerRecordId) ?? 0) + 1;
    this.failures.set(providerRecordId, failures);
    if (failures < FAILURES_TO_OPEN) return false;
    this.openUntil.set(providerRecordId, this.now() + OPEN_MS);
    return true;
  }
}
