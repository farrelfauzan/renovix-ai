import type { PaymentProviderName } from "../types/payment-provider-name";
import { isPaymentsForcedOff } from "./is-payments-forced-off";

/**
 * Which payment provider this process uses, from PAYMENT_PROVIDER (RNX-35), checked at boot before anything starts.
 * Outside production an unset value means "fake" (tests and local development). In production it must be set; an
 * unknown value refuses everywhere; and "fake" is refused in production unless PAYMENTS_FORCE_OFF=true, so production
 * can boot before a real adapter exists (RNX-229) but can never take a payment through the fake.
 */
export function resolvePaymentProviderName(env: NodeJS.ProcessEnv): PaymentProviderName {
  const value = env.PAYMENT_PROVIDER;
  const isProduction = env.NODE_ENV === "production";
  if (!value && isProduction) throw new Error("PAYMENT_PROVIDER must be set in production");
  if (value && value !== "fake") throw new Error(`PAYMENT_PROVIDER must be "fake" (got "${value}")`);
  if (isProduction && !isPaymentsForcedOff(env)) {
    throw new Error("PAYMENT_PROVIDER=fake is allowed in production only with PAYMENTS_FORCE_OFF=true");
  }
  return "fake";
}
