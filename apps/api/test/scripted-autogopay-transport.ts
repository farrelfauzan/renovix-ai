import type { AutoGoPayRequestOptions } from "../src/app/payments/types/autogopay-request-options";
import type { AutoGoPayResponse } from "../src/app/payments/types/autogopay-response";
import type { AutoGoPayTransport } from "../src/app/payments/types/autogopay-transport";
import { autoGoPayFixtures as fx } from "./autogopay-fixtures";
import { toAutoGoPayTime } from "./to-autogopay-time";

type Answer = AutoGoPayResponse | Error | "timeout" | "slow";
type Call = { readonly path: string; readonly body: Readonly<Record<string, unknown>>; readonly options: AutoGoPayRequestOptions };

const QUARTER_HOUR_MS = 15 * 60_000;

/**
 * RNX-229, RNX-273: a scriptable AutoGoPay transport for the payments specs, answering the recorded fixtures (no
 * network), every answer in the documented envelope `{ success, message, data }` with WIB date-times. Each generate
 * answers a new transaction id (`agp-test-txn-<n>`) expiring in 15 minutes; a status check answers what
 * was set for its transaction id (pending by default). "timeout" rejects at once as AbortSignal.timeout does; "slow"
 * answers nothing and rejects only when the call's own timeout runs out; an Error is thrown as it is. Every call is recorded.
 */
export class ScriptedAutoGoPayTransport implements AutoGoPayTransport {
  readonly calls: Call[] = [];
  private readonly statuses = new Map<string, Answer>();
  private generateAnswers: Answer[] = [];
  private count = 0;

  /** Forgets the calls and the script. */
  reset(): void {
    this.calls.length = 0;
    this.statuses.clear();
    this.generateAnswers = [];
  }

  /** The next generate answers this instead of a new charge. */
  answerNextGenerate(answer: Answer): void {
    this.generateAnswers.push(answer);
  }

  /** The status check of this transaction answers `transaction_status` with the amount (and paid_at now for a settlement). */
  setStatus(transactionId: string, transactionStatus: string, amount?: number): void {
    const paidAt = transactionStatus === "settlement" ? { paid_at: toAutoGoPayTime(new Date()) } : {};
    this.statuses.set(transactionId, { status: 200, body: { success: true, message: "Status retrieved", data: { transaction_id: transactionId, transaction_status: transactionStatus, amount, ...paidAt } } });
  }

  /** The status check of this transaction answers this (a raw answer, "timeout" or "slow"). */
  answerStatus(transactionId: string, answer: Answer): void {
    this.statuses.set(transactionId, answer);
  }

  /** The calls made to one path. */
  callsTo(path: string): Call[] {
    return this.calls.filter((call) => call.path === path);
  }

  async post(path: string, body: Readonly<Record<string, unknown>>, options: AutoGoPayRequestOptions): Promise<AutoGoPayResponse> {
    this.calls.push({ path, body, options });
    return this.settle(this.answerFor(path, body), options);
  }

  private answerFor(path: string, body: Readonly<Record<string, unknown>>): Answer {
    if (path === "/qris/generate") return this.generateAnswers.shift() ?? this.newCharge(body.amount as number);
    if (path === "/qris/status") return this.statuses.get(body.transaction_id as string) ?? fx.status.pending;
    return fx.cancel.success;
  }

  private newCharge(amount: number): AutoGoPayResponse {
    this.count += 1;
    const transactionId = `agp-test-txn-${this.count}`;
    const data = { ...fx.generate.success.body.data, transaction_id: transactionId, amount, expiry_time: toAutoGoPayTime(new Date(Date.now() + QUARTER_HOUR_MS)) };
    return { status: 200, body: { ...fx.generate.success.body, data } };
  }

  private settle(answer: Answer, options: AutoGoPayRequestOptions): Promise<AutoGoPayResponse> {
    if (answer === "timeout") return Promise.reject(Object.assign(new Error("The operation was aborted due to timeout"), { name: "TimeoutError" }));
    if (answer instanceof Error) return Promise.reject(answer);
    if (answer === "slow") {
      const signal = AbortSignal.timeout(options.timeoutMs);
      return new Promise((_resolve, reject) => signal.addEventListener("abort", () => reject(signal.reason)));
    }
    return Promise.resolve(answer);
  }
}
