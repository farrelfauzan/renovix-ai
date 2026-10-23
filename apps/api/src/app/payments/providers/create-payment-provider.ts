import type { PaymentProvider } from "../types/payment-provider";
import type { PaymentProviderName } from "../types/payment-provider-name";
import { FakePaymentProvider } from "./fake-payment.provider";

/** The provider named by PAYMENT_PROVIDER (RNX-35). The fake signs webhooks with PAYMENT_FAKE_WEBHOOK_SECRET (local development only). */
export function createPaymentProvider(name: PaymentProviderName, env: NodeJS.ProcessEnv): PaymentProvider {
  switch (name) {
    case "fake":
      return new FakePaymentProvider({ webhookSecret: env.PAYMENT_FAKE_WEBHOOK_SECRET });
  }
}
