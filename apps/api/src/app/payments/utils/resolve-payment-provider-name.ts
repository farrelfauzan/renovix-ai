import type { PaymentProviderName } from "../types/payment-provider-name";
import { isPaymentsForcedOff } from "./is-payments-forced-off";

/**
 * Which payment provider this process uses, from PAYMENT_PROVIDER (RNX-35), checked at boot before anything starts.
 * Outside production an unset value means "fake" (tests and local development). In production it must be set; an
 * unknown value refuses everywhere; and "fake" is refused in production unless PAYMENTS_FORCE_OFF=true, so production
 * can never take a payment through the fake. "autogopay" (RNX-229) is accepted everywhere, but only with a non-empty
 * PAYMENT_PROVIDER_API_KEY (RX-110 pattern: the error names the variable, never a value).
 */
export function resolvePaymentProviderName(env: NodeJS.ProcessEnv): PaymentProviderName {
  const value = env.PAYMENT_PROVIDER;
  const isProduction = env.NODE_ENV === "production";
  if (!value && isProduction) throw new Error("PAYMENT_PROVIDER must be set in production");
  if (value === "autogopay") {
    if (!env.PAYMENT_PROVIDER_API_KEY?.trim()) throw new Error("PAYMENT_PROVIDER_API_KEY is required when PAYMENT_PROVIDER=autogopay and is not set");
    return "autogopay";
  }
  if (value && value !== "fake") throw new Error(`PAYMENT_PROVIDER must be "fake" or "autogopay" (got "${value}")`);
  if (isProduction && !isPaymentsForcedOff(env)) {
    throw new Error("PAYMENT_PROVIDER=fake is allowed in production only with PAYMENTS_FORCE_OFF=true");
  }
  return "fake";
}
